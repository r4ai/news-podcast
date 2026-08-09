import type { paths } from "@news-podcast/contracts/openapi"
import createFetchClient from "openapi-fetch"
import createQueryClient from "openapi-react-query"

export const fetchClient = createFetchClient<paths>({
  baseUrl: "",
  credentials: "include",
})

export const api = createQueryClient(fetchClient)

export async function loginForDevelopment(password: string): Promise<void> {
  const response = await fetch("/api/dev/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) throw new Error("開発ログインを利用できません")
}
