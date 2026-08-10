import { createFileRoute } from "@tanstack/react-router"

import { settingsQueryOptions } from "@/features/settings"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { ScheduleForm } from "./-components/schedule-form"

export const Route = createFileRoute("/_authenticated/schedule/")({
  // awaitしない先読み。未達ならPanelのfallbackが出る。
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(settingsQueryOptions)
  },
  component: ScheduleRoute,
})

function ScheduleRoute() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        description="指定したタイムゾーンの時刻に、ニュース番組を自動生成します。"
        title="生成時刻"
      />
      <Panel name="schedule-form">
        <ScheduleForm />
      </Panel>
    </div>
  )
}
