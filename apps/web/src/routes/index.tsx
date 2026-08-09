import { createFileRoute } from "@tanstack/react-router"

import { GenerationPage } from "@/features/generation/generation-page"

export const Route = createFileRoute("/")({ component: GenerationPage })
