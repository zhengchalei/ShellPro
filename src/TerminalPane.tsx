import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import "@xterm/xterm/css/xterm.css";
import { hasTauriRuntime, shellProApi } from "./api";
import type {
  TerminalEvent,
  TerminalPreferences,
  TerminalSession,
} from "./types";

const darkTerminalTheme = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#7dd3fc",
  selectionBackground: "#315375",
  black: "#0d1117",
  red: "#ff7b72",
  green: "#7ee787",
  yellow: "#f2cc60",
  blue: "#79c0ff",
  magenta: "#d2a8ff",
  cyan: "#a5d6ff",
  white: "#f0f6fc",
};

const lightTerminalTheme = {
  background: "#fbfbfd",
  foreground: "#1f2937",
  cursor: "#0567d8",
  selectionBackground: "#bfdbfe",
  black: "#111827",
  red: "#b42318",
  green: "#0f6a31",
  yellow: "#8a5a00",
  blue: "#075985",
  magenta: "#7c3aed",
  cyan: "#0f766e",
  white: "#f9fafb",
};

function resolveTerminalTheme(preferences: TerminalPreferences) {
  const theme = preferences.theme === "system" ? "dark" : preferences.theme;
  return theme === "dark" ? darkTerminalTheme : lightTerminalTheme;
}

export type TerminalPaneHandle = {
  clear: () => void;
  findNext: (term: string) => boolean;
  findPrevious: (term: string) => boolean;
  focus: () => void;
  getSelection: () => string;
  writeInput: (data: string) => Promise<void>;
};

type TerminalPaneProps = {
  session: TerminalSession;
  active: boolean;
  visible: boolean;
  preferences: TerminalPreferences;
  onActivate: () => void;
  onBufferChange: (sessionId: string, data: string) => void;
  onStatusChange: (sessionId: string, status: TerminalSession["status"]) => void;
  terminalHint: string;
  disconnectedMessage: string;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(
{
  session,
  active,
  visible,
  preferences,
  onActivate,
  onBufferChange,
  onStatusChange,
  terminalHint,
  disconnectedMessage,
}: TerminalPaneProps,
ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => terminalRef.current?.clear(),
      findNext: (term: string) =>
        searchRef.current?.findNext(term, { incremental: false }) ?? false,
      findPrevious: (term: string) =>
        searchRef.current?.findPrevious(term, { incremental: false }) ?? false,
      focus: () => terminalRef.current?.focus(),
      getSelection: () => terminalRef.current?.getSelection() ?? "",
      writeInput: async (data: string) => {
        if (!data) {
          return;
        }
        if (!hasTauriRuntime()) {
          terminalRef.current?.write(data);
          onBufferChange(session.id, data);
          return;
        }
        await shellProApi.writeToSession(session.id, data);
      },
    }),
    [onBufferChange, session.id],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: preferences.scrollback,
      fontFamily: preferences.fontFamily,
      fontSize: preferences.fontSize,
      lineHeight: 1.18,
      letterSpacing: 0,
      theme: resolveTerminalTheme(preferences),
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(containerRef.current);
    terminal.writeln(`ShellPro ${session.title}`);
    terminal.writeln(terminalHint);
    terminal.writeln("");
    fitAddon.fit();

    const dataDisposable = terminal.onData((data) => {
      if (!hasTauriRuntime()) {
        terminal.write(data);
        onBufferChange(session.id, data);
        return;
      }
      void shellProApi.writeToSession(session.id, data);
    });

    terminalRef.current = terminal;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    const resize = () => {
      fitAddon.fit();
      const dimensions = fitAddon.proposeDimensions();
      if (dimensions) {
        void shellProApi.resizeSession(
          session.id,
          dimensions.cols,
          dimensions.rows,
        );
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(containerRef.current);
    resize();

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [onBufferChange, session.id, session.title, terminalHint]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontFamily = preferences.fontFamily;
    terminal.options.fontSize = preferences.fontSize;
    terminal.options.scrollback = preferences.scrollback;
    terminal.options.theme = resolveTerminalTheme(preferences);
    fitRef.current?.fit();
  }, [preferences]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    const unlistenPromise = listen<TerminalEvent>("terminal://event", (event) => {
      const message = event.payload;
      if (message.sessionId !== session.id) {
        return;
      }

      if (message.event === "data") {
        terminalRef.current?.write(message.payload.data);
        onBufferChange(session.id, message.payload.data);
      }

      if (message.event === "exit") {
        onStatusChange(session.id, "disconnected");
        terminalRef.current?.writeln(`\r\n[ShellPro] ${disconnectedMessage}`);
      }

      if (message.event === "error") {
        onStatusChange(session.id, "error");
        terminalRef.current?.writeln(
          `\r\n[ShellPro] ${message.payload.message}`,
        );
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [disconnectedMessage, onBufferChange, onStatusChange, session.id]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (active) {
        terminalRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active, visible]);

  return (
    <div
      className={[
        "terminal-pane",
        visible ? "is-visible" : "",
        active ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={onActivate}
      ref={containerRef}
    />
  );
});
