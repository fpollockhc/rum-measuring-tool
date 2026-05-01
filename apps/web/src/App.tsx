import { useState } from "react";
import { Button, Content, Header, HeaderName } from "@carbon/react";
import { WizardCards } from "./components/WizardCards";
import { DeployActions } from "./components/DeployActions";
import { Dashboard } from "./components/Dashboard";
import { TerminalPanel } from "./components/TerminalPanel";
import { UnmanagedEstimatorTab } from "./components/UnmanagedEstimatorTab";
import { TfeMigrationTab } from "./components/TfeMigrationTab";
import { CombinedSummaryBanner } from "./components/CombinedSummaryBanner";
import { PackSizingTab } from "./components/PackSizingTab";
import { ReportingDashboard } from "./components/ReportingDashboard";

export function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"managed" | "unmanaged" | "tfe" | "pack" | "reporting">("managed");

  return (
    <>
      <Header aria-label="TFC RUM Calculator">
        <HeaderName href="#" prefix="IBM">Terraform Cloud RUM Assistant</HeaderName>
      </Header>
      <Content id="main-content" className="layout">
        <section className="hero">
          <h1>Resource Under Management Migration Assistant</h1>
          <p>Card-guided scan setup, one-click deployment actions, and RUM analytics dashboard for OSS-to-TFC onboarding.</p>
        </section>

        <CombinedSummaryBanner />

        <section className="tab-row">
          <Button kind={activeTab === "managed" ? "primary" : "tertiary"} onClick={() => setActiveTab("managed")}>
            Managed State Scanner
          </Button>
          <Button kind={activeTab === "unmanaged" ? "primary" : "tertiary"} onClick={() => setActiveTab("unmanaged")}>
            Unmanaged Estimator
          </Button>
          <Button kind={activeTab === "tfe" ? "primary" : "tertiary"} onClick={() => setActiveTab("tfe")}>
            TFE Migration
          </Button>
          <Button kind={activeTab === "pack" ? "primary" : "tertiary"} onClick={() => setActiveTab("pack")}>
            Pack Sizing
          </Button>
          <Button kind={activeTab === "reporting" ? "primary" : "tertiary"} onClick={() => setActiveTab("reporting")}>
            Reporting
          </Button>
        </section>

        {/* All tabs stay mounted to preserve state — hidden via CSS display */}
        <div style={{ display: activeTab === "managed" ? "block" : "none" }}>
          <section className="two-col">
            <WizardCards onScanStarted={() => setRefreshKey((k) => k + 1)} />
            <DeployActions />
          </section>

          <section>
            <Dashboard refreshKey={refreshKey} />
          </section>

          <section>
            <TerminalPanel />
          </section>
        </div>

        <div style={{ display: activeTab === "unmanaged" ? "block" : "none" }}>
          <section>
            <UnmanagedEstimatorTab />
          </section>
        </div>

        <div style={{ display: activeTab === "tfe" ? "block" : "none" }}>
          <section>
            <TfeMigrationTab />
          </section>
        </div>

        <div style={{ display: activeTab === "pack" ? "block" : "none" }}>
          <section>
            <PackSizingTab />
          </section>
        </div>

        <div style={{ display: activeTab === "reporting" ? "block" : "none" }}>
          <section>
            <ReportingDashboard />
          </section>
        </div>
      </Content>
    </>
  );
}
