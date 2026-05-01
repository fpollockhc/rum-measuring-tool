import { Button, TextInput, Tile } from "@carbon/react";
import { useState } from "react";
import { terminalExec } from "../lib/api";

export function TerminalPanel() {
  const [command, setCommand] = useState("scan --config apps/cli/sample-config.yaml");
  const [output, setOutput] = useState("Terminal ready. Allowed commands: scan, validate, export, help");

  async function onRun() {
    const response = await terminalExec(command);
    setOutput(response.output ?? response.error ?? "No output");
  }

  return (
    <Tile className="card">
      <h3>CLI Terminal (UI)</h3>
      <p>Restricted terminal bridge for users who prefer command execution from the UI.</p>
      <TextInput id="terminal-command" labelText="Command" value={command} onChange={(e) => setCommand(e.currentTarget.value)} />
      <div className="terminal-actions">
        <Button kind="primary" onClick={onRun}>Run</Button>
      </div>
      <pre className="terminal-output">{output}</pre>
    </Tile>
  );
}
