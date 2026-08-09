import type { paths } from "@news-podcast/contracts/openapi"
import createFetchClient from "openapi-fetch"
import createQueryClient from "openapi-react-query"

import { currentPath } from "@/auth/auth"

export const fetchClient = createFetchClient<paths>({
  baseUrl: "",
  credentials: "include",
})

fetchClient.use({
  onResponse({ request, response }) {
    const path = new URL(request.url).pathname
    if (
      response.status === 401 &&
      path.startsWith("/v1/") &&
      window.location.pathname !== "/login"
    ) {
      const redirect = encodeURIComponent(currentPath())
      window.location.replace(`/login?redirect=${redirect}`)
    }
    return response
  },
})

export const api = createQueryClient(fetchClient)

export async function loginForDevelopment(password: string): Promise<void> {
  const response = await fetch("/api/dev/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
  if (response.status === 401) {
    throw new Error("パスワードが正しくありません")
  }
  if (!response.ok) {
    throw new Error("開発ログインを利用できません")
  }
}
