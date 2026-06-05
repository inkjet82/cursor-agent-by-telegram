import type { Env } from "./env.js";
import { loadModelEnvConfig, type ModelEnvConfig } from "./config/model-env.js";
import { UserStateStore } from "./store/user-state.js";
import { ModelCatalog } from "./services/model-catalog.js";
import { SessionStore } from "./store/session-store.js";
import { WorkspaceStore } from "./store/workspace-store.js";
import { JobQueue } from "./services/job-queue.js";
import { CursorRunner } from "./services/cursor-runner.js";
import { CursorUsageService } from "./services/cursor-usage/service.js";

export interface AppContext {
  env: Env;
  modelConfig: ModelEnvConfig;
  modelCatalog: ModelCatalog;
  userStore: UserStateStore;
  sessionStore: SessionStore;
  workspaceStore: WorkspaceStore;
  jobQueue: JobQueue;
  runner: CursorRunner;
  usageService: CursorUsageService;
}

export async function createContext(env: Env): Promise<AppContext> {
  const modelConfig = await loadModelEnvConfig(env);
  const userStore = new UserStateStore(env);
  const modelCatalog = new ModelCatalog(env.CURSOR_API_KEY);
  const sessionStore = new SessionStore();
  const workspaceStore = new WorkspaceStore();
  const jobQueue = new JobQueue();
  const runner = new CursorRunner(
    env,
    modelConfig,
    modelCatalog,
    userStore,
    sessionStore,
    workspaceStore,
    jobQueue,
  );
  const usageService = new CursorUsageService(env);
  return {
    env,
    modelConfig,
    modelCatalog,
    userStore,
    sessionStore,
    workspaceStore,
    jobQueue,
    runner,
    usageService,
  };
}

import type { Context } from "grammy";

export type BotContext = Context & { app: AppContext };
