import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { hasTauriRuntime, shellProApi } from "./api";
import type { TerminalEvent, TerminalSession } from "./types";

type TerminalPaneProps = {
  session: TerminalSession;
  active: boolean;
  onBufferChange: (sessionId: string, data: string) => void;
  onStatusChange: (sessionId: string, status: TerminalSession["status"]) => void;
  terminalHint: string;
  disconnectedMessage: string;
};

export function TerminalPane({
  session,
  active,
  onBufferChange,
  onStatusChange,
  terminalHint,
  disconnectedMessage,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      fontFamily:
        "'SF Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.18,
      letterSpacing: 0,
      theme: {
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
      },
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
    };
  }, [onBufferChange, session.id, session.title, terminalHint]);

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
    if (active) {
      terminalRef.current?.focus();
      fitRef.current?.fit();
    }
  }, [active]);

  return (
    <div
      className={`terminal-pane ${active ? "is-active" : ""}`}
      ref={containerRef}
    />
  );
}
