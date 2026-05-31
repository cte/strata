import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview, ReactRenderer } from "@storybook/react-vite";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Our globals.css paints the iframe body via var(--bg); don't let
    // Storybook's backgrounds feature override it (it tracks the theme toolbar).
    backgrounds: { disable: true },
    layout: "centered",
  },
  decorators: [
    withThemeByDataAttribute<ReactRenderer>({
      themes: { dark: "dark", light: "light" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
  ],
};

export default preview;
