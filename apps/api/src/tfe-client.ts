import https from "node:https";

export type TfeClientOptions = {
  hostname: string;
  token: string;
  tlsInsecure?: boolean;
};

export type TfeProject = {
  id: string;
  attributes: {
    name: string;
    description?: string;
    "workspace-count"?: number;
  };
};

export type TfeWorkspace = {
  id: string;
  attributes: {
    name: string;
    "terraform-version"?: string;
    "resource-count"?: number;
    "updated-at"?: string;
  };
  relationships?: {
    project?: {
      data?: { id: string; type: string };
    };
  };
};

export type TfeStateVersion = {
  id: string;
  attributes: {
    serial: number;
    "hosted-state-download-url": string;
    "created-at": string;
  };
};

type TfeApiResponse<T> = {
  data: T;
  meta?: {
    pagination?: {
      "current-page": number;
      "next-page": number | null;
      "total-pages": number;
      "total-count": number;
    };
  };
};

function buildAgent(tlsInsecure?: boolean): https.Agent | undefined {
  if (tlsInsecure) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined;
}

async function tfeApiFetch<T>(
  url: string,
  token: string,
  tlsInsecure?: boolean
): Promise<T> {
  const agent = buildAgent(tlsInsecure);
  const fetchOptions: RequestInit & { dispatcher?: unknown } = {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json"
    }
  };

  // Node 18+ uses the undici agent for fetch; for https.Agent we need a workaround.
  // We use the global agent approach for self-signed cert support.
  if (agent) {
    (fetchOptions as Record<string, unknown>).dispatcher = agent;
  }

  const response = await fetch(url, fetchOptions);

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const delayMs = retryAfter ? Number(retryAfter) * 1000 : 5000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return tfeApiFetch<T>(url, token, tlsInsecure);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TFE API ${response.status}: ${response.statusText} — ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function validateConnection(options: TfeClientOptions): Promise<{
  orgName: string;
  email?: string;
}> {
  const url = `${options.hostname}/api/v2/organizations/${encodeURIComponent("__ping__")}`;

  // We actually validate by hitting the org endpoint
  const orgUrl = `${options.hostname}/api/v2/ping`;
  const response = await fetch(orgUrl, {
    headers: { Authorization: `Bearer ${options.token}` }
  });

  if (!response.ok) {
    throw new Error(`Connection failed: ${response.status} ${response.statusText}`);
  }

  return { orgName: "validated" };
}

export async function getOrganization(
  options: TfeClientOptions,
  orgName: string
): Promise<{ name: string; email?: string }> {
  type OrgData = { id: string; attributes: { name: string; email?: string } };
  const result = await tfeApiFetch<TfeApiResponse<OrgData>>(
    `${options.hostname}/api/v2/organizations/${encodeURIComponent(orgName)}`,
    options.token,
    options.tlsInsecure
  );
  return {
    name: result.data.attributes.name,
    email: result.data.attributes.email
  };
}

export async function listProjects(
  options: TfeClientOptions,
  orgName: string
): Promise<TfeProject[]> {
  const projects: TfeProject[] = [];
  let page = 1;
  const pageSize = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${options.hostname}/api/v2/organizations/${encodeURIComponent(orgName)}/projects?page[size]=${pageSize}&page[number]=${page}`;
    const result = await tfeApiFetch<TfeApiResponse<TfeProject[]>>(
      url,
      options.token,
      options.tlsInsecure
    );

    projects.push(...result.data);

    const nextPage = result.meta?.pagination?.["next-page"];
    if (!nextPage) break;
    page = nextPage;
  }

  return projects;
}

export type ListWorkspacesOptions = {
  nameFilter?: string;
  projectId?: string;
};

export async function listAllWorkspaces(
  options: TfeClientOptions,
  orgName: string,
  filterOptions?: ListWorkspacesOptions | string
): Promise<TfeWorkspace[]> {
  // Backward compat: if filterOptions is a string, treat as nameFilter
  const opts: ListWorkspacesOptions =
    typeof filterOptions === "string" ? { nameFilter: filterOptions } : (filterOptions ?? {});

  const workspaces: TfeWorkspace[] = [];
  let page = 1;
  const pageSize = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let url = `${options.hostname}/api/v2/organizations/${encodeURIComponent(orgName)}/workspaces?page[size]=${pageSize}&page[number]=${page}`;
    if (opts.nameFilter) {
      url += `&search[name]=${encodeURIComponent(opts.nameFilter)}`;
    }
    if (opts.projectId) {
      url += `&filter[project][id]=${encodeURIComponent(opts.projectId)}`;
    }

    const result = await tfeApiFetch<TfeApiResponse<TfeWorkspace[]>>(
      url,
      options.token,
      options.tlsInsecure
    );

    workspaces.push(...result.data);

    const nextPage = result.meta?.pagination?.["next-page"];
    if (!nextPage) break;
    page = nextPage;
  }

  return workspaces;
}

export async function getCurrentStateVersion(
  options: TfeClientOptions,
  workspaceId: string
): Promise<TfeStateVersion | null> {
  try {
    const result = await tfeApiFetch<TfeApiResponse<TfeStateVersion>>(
      `${options.hostname}/api/v2/workspaces/${encodeURIComponent(workspaceId)}/current-state-version`,
      options.token,
      options.tlsInsecure
    );
    return result.data;
  } catch (error) {
    // Workspace may have no state yet
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

export async function downloadState(
  options: TfeClientOptions,
  downloadUrl: string
): Promise<string> {
  const agent = buildAgent(options.tlsInsecure);
  const fetchOptions: RequestInit & { dispatcher?: unknown } = {
    headers: {
      Authorization: `Bearer ${options.token}`
    }
  };

  if (agent) {
    (fetchOptions as Record<string, unknown>).dispatcher = agent;
  }

  const response = await fetch(downloadUrl, fetchOptions);

  if (!response.ok) {
    throw new Error(`State download failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}
