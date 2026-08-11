import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { settingsQueryOptions } from "@/features/settings"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"
import {
  isSubmittable,
  recomputeTargetCount,
  toDraft,
  type InterestProfileDraft,
} from "../-model"

/**
 * 興味プロフィール(include/exclude)の編集フォーム。保存は即座に反映せず、
 * 「N件のスコアを再計算しますか」の確認ダイアログを一度挟む
 * （プロフィールを変えると既存のarticle_relevance行がprofile_hash不一致で
 * 「未処理」扱いになり、日次バッチ/オンデマンド再処理の対象が増えるため）。
 */
export function useInterestProfileForm() {
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(settingsQueryOptions)
  // 再計算対象の目安として、絞り込み無しの全記事数を使う。
  const totalQuery = api.useQuery("get", "/v1/me/articles/facets")
  const save = api.useMutation("patch", "/v1/me/settings")
  const initial = settings.interestProfile
  const [draft, setDraft] = useState<InterestProfileDraft>(() =>
    toDraft(initial)
  )
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function update(patch: Partial<InterestProfileDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function requestSave() {
    setConfirmOpen(true)
  }

  function cancelSave() {
    setConfirmOpen(false)
  }

  function confirmSave() {
    setConfirmOpen(false)
    startTransition(async () => {
      try {
        const updated = await save.mutateAsync({
          body: { interestProfile: draft },
        })
        queryClient.setQueryData(settingsQueryOptions.queryKey, updated)
        await queryClient.invalidateQueries({
          queryKey: ["get", "/v1/me/articles"],
        })
        recordBrowserEvent("interest_profile.changed", { result: "succeeded" })
        toast.success("興味プロフィールを保存しました")
      } catch {
        recordBrowserEvent("interest_profile.changed", { result: "failed" })
        toast.error("興味プロフィールを保存できませんでした")
      }
    })
  }

  return {
    draft,
    pending,
    confirmOpen,
    recomputeCount: recomputeTargetCount(totalQuery.data?.states.all),
    canSubmit: isSubmittable(draft) && !pending,
    update,
    requestSave,
    cancelSave,
    confirmSave,
  } as const
}

export type InterestProfileFormState = ReturnType<typeof useInterestProfileForm>
