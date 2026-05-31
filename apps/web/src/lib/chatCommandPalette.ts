import { createContext, useContext } from "react";

/**
 * Opens the ⌘K chat-session command palette. Provided by the app layout in
 * `router.tsx` and consumed anywhere under it (sidebar, chat toolbar) without a
 * router ↔ chat import cycle.
 */
const noopOpenChatSessionCommandPalette = () => {};

export const ChatSessionCommandPaletteContext = createContext<() => void>(
  noopOpenChatSessionCommandPalette,
);

export function useOpenChatSessionCommandPalette(): () => void {
  return useContext(ChatSessionCommandPaletteContext);
}
