import type { Preview } from "@storybook/react-vite"

import "@workspace/ui/globals.css"

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
  },
}

export default preview
