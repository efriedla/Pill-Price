import type { Preview } from "@storybook/nextjs-vite";

// Storybook renders against the real token layer, not a copy of it.
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      options: {
        base: { name: "Base", value: "#F8F7FC" },
        raised: { name: "Raised", value: "#FFFFFF" },
      },
    },
    a11y: {
      // 'todo' until W5, when `jest-axe`/axe violations become a build failure
      // (roadmap W5 definition of done). Flipping this to 'error' is its own PR.
      test: "todo",
    },
  },
  initialGlobals: {
    backgrounds: { value: "base" },
  },
  decorators: [
    (Story) => (
      <div className="font-body text-text-primary">
        <Story />
      </div>
    ),
  ],
};

export default preview;
