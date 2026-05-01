import { Button, Tile } from "@carbon/react";

export function DeployActions() {
  const deployLocal = `docker compose up --build`;
  const deployCli = `npm run build -w @rum-tool/cli && node apps/cli/dist/apps/cli/src/index.js scan -c apps/cli/sample-config.yaml`;

  return (
    <Tile className="card">
      <h3>Deployment Actions</h3>
      <p>Choose a deployment path. Commands are copied from the panel below.</p>
      <div className="deploy-buttons">
        <Button kind="primary" onClick={() => navigator.clipboard.writeText(deployLocal)}>
          Deploy Local (Docker)
        </Button>
        <Button kind="tertiary" onClick={() => navigator.clipboard.writeText(deployCli)}>
          Deploy CLI Runner
        </Button>
      </div>
      <pre className="command-block">{deployLocal}\n{deployCli}</pre>
    </Tile>
  );
}
