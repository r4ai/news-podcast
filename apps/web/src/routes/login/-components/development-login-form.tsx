import { Button } from "@workspace/ui/components/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"

export type DevelopmentLoginFormProps = {
  readonly error?: string
  readonly password: string
  readonly pending: boolean
  readonly setPassword: (value: string) => void
  readonly onSubmit: () => void
}

export function DevelopmentLoginForm({
  error,
  onSubmit,
  password,
  pending,
  setPassword,
}: DevelopmentLoginFormProps) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="development-password">開発パスワード</FieldLabel>
        <Input
          aria-invalid={Boolean(error)}
          autoComplete="current-password"
          disabled={pending}
          id="development-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <FieldError>{error}</FieldError>
      </Field>
      <Button disabled={pending || password.length === 0} type="submit">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {pending ? "ログイン中…" : "開発ユーザーでログイン"}
      </Button>
    </form>
  )
}
