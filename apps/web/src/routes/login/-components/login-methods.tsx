import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { FieldGroup, FieldSeparator } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"

import type { AuthState } from "@/features/auth"
import { loginMethodCount, type LoginState } from "../-hooks/use-login"
import { DevelopmentLoginForm } from "./development-login-form"

export type LoginMethodsProps = {
  readonly auth: AuthState
  readonly login: LoginState
}

export function LoginMethods({ auth, login }: LoginMethodsProps) {
  const { development, google } = auth.loginMethods
  const methodCount = loginMethodCount(auth)

  if (methodCount === 0) {
    return (
      <Alert>
        <AlertTitle>ログイン方法が設定されていません</AlertTitle>
        <AlertDescription>
          管理者に認証設定を確認してください。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <FieldGroup>
      {google ? (
        <Button
          disabled={login.pending}
          onClick={login.submitGoogle}
          type="button"
          variant={methodCount === 2 ? "outline" : "default"}
        >
          {login.pending ? <Spinner data-icon="inline-start" /> : null}
          Googleでログイン
        </Button>
      ) : null}
      {methodCount === 2 ? <FieldSeparator>開発用</FieldSeparator> : null}
      {development ? (
        <DevelopmentLoginForm
          error={login.error}
          onSubmit={login.submitDevelopment}
          password={login.password}
          pending={login.pending}
          setPassword={login.setPassword}
        />
      ) : null}
      {/* 開発フォームがないときはField内にエラーを出す場所がないので、ここで出す。 */}
      {!development && login.error ? (
        <Alert variant="destructive">
          <AlertTitle>ログインできませんでした</AlertTitle>
          <AlertDescription>{login.error}</AlertDescription>
        </Alert>
      ) : null}
    </FieldGroup>
  )
}
