export type ApiErrorCode =
  | 'RATE_LIMITED'
  | 'DAILY_QUOTA_EXHAUSTED'
  | 'QUEUE_FULL'
  | 'POW_FAILED'
  | 'INVALID_API_KEY'
  | 'UPSTREAM_UNAVAILABLE'
  | 'BROWSER_LAUNCH_FAILED'
  | 'INVALID_REQUEST'
  | 'INVALID_URL'
  | 'NETWORK_ERROR'
  | string;

export type JobStatus =
  | 'pending'
  | 'crawling'
  | 'planning'
  | 'generating'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepType =
  | 'crawl'
  | 'plan'
  | 'generate'
  | 'validate'
  | 'execute'
  | 'correct';

export type StepStatus = 'success' | 'failure';

export type TestFinalStatus = 'passed' | 'failed' | 'gave_up' | 'needs_review';

export type FailureClass = 'finding' | 'locator' | 'timeout' | 'other';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface ConfidenceFactor {
  label: string;
  points: number;
}

export interface ConfidenceScore {
  score: number;
  band: ConfidenceBand;
  factors: ConfidenceFactor[];
}

export interface TokenUsageRow {
  provider: string;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  rows: TokenUsageRow[];
}

export interface ElementSelectorMap {
  getByTestId?: string | null;
  getByRole?: string | null;
  getByPlaceholder?: string | null;
  getByLabel?: string | null;
  getByText?: string | null;
  css: string;
}

export interface InteractiveElement {
  id: string;
  tagName: string;
  type: string;
  detectedBy: string;
  inputType?: string | null;
  text?: string | null;
  name?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
  ariaRole?: string | null;
  testId?: string | null;
  value?: string | null;
  href?: string | null;
  page?: number;
  isVisible: boolean;
  isEnabled: boolean;
  isRequired?: boolean;
  isReadOnly?: boolean;
  selectors: ElementSelectorMap;
}

export interface AppForm {
  id: string;
  name?: string | null;
  action?: string | null;
  method?: string | null;
  purpose: 'login' | 'signup' | 'search' | 'unknown';
  fieldIds: string[];
  submitButtonId?: string | null;
}

export interface AppMap {
  url: string;
  title: string;
  crawledAt: string;
  viewport: {
    width: number;
    height: number;
  };
  elements: InteractiveElement[];
  forms: AppForm[];
  discoveredLinks: string[];
  discoveredLinkLabels?: Record<string, string>;
  discoveredLinkTotal?: number;
  totalElementsFound: number;
  isTruncated: boolean;
}

export interface PlanStep {
  action: string;
  elementId: string | null;
  value: string | null;
  description: string;
}

export interface PlannedTestCase {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  origin?: 'llm' | 'baseline';
}

export interface TestPlan {
  testCases: PlannedTestCase[];
}

export interface TestAttempt {
  attemptNumber: number;
  code: string;
  validationPassed: boolean;
  validationErrors?: string[];
  executionPassed?: boolean;
  executionError?: string;
  failureClass?: FailureClass;
  durationMs?: number;
  corrected: boolean;
}

export interface PipelineGeneratedTest {
  testCaseId: string;
  filename: string;
  code: string;
  status: TestFinalStatus;
  attempts: TestAttempt[];
  confidence: ConfidenceScore;
}

// POST /api/generate -> 202. One id per unique URL, in request order.
export interface GenerateAcceptedResponse {
  jobIds: string[];
  runGroupId?: string;
  queuePosition?: number;
  webhookSecret?: string;
}

export interface AgentStep {
  id: string;
  jobId: string;
  stepType: StepType;
  testCaseId: string | null;
  attemptNumber: number | null;
  status: StepStatus;
  latencyMs: number | null;
  llmProvider: string | null;
  llmModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  errorDetail: string | null;
  createdAt: string;
}

export interface ExecutionResult {
  id: string;
  generatedTestId: string;
  attemptNumber: number;
  code: string;
  validationPassed: boolean;
  validationErrors: unknown;
  executionPassed: boolean | null;
  executionError: string | null;
  failureClass: FailureClass | null;
  failureContext?: { finalUrl: string; navigations: string[] } | null;
  failureSummary?: {
    kind: string;
    headline: string;
    expected?: string;
    received?: string;
    target?: string;
    line?: number;
    codeFrame?: string;
  } | null;
  durationMs: number | null;
  corrected: boolean;
  createdAt: string;
}

export interface PersistedGeneratedTest {
  id: string;
  jobId: string;
  testCaseId: string;
  filename: string;
  finalCode: string;
  finalStatus: TestFinalStatus;
  totalAttempts: number;
  createdAt: string;
  executionResults: ExecutionResult[];
  confidence: ConfidenceScore;
  failureSummary?: {
    kind: string;
    headline: string;
    expected?: string;
    received?: string;
    target?: string;
    line?: number;
    codeFrame?: string;
  } | null;
  failureContext?: {
    finalUrl?: string;
    canonicalUrl?: string;
    navigations?: string[];
    navigatedAway?: boolean;
    [key: string]: unknown;
  } | null;
}

export interface JobDetail {
  id: string;
  targetUrl: string;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
  appMap: AppMap | null;
  testPlan: TestPlan | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt?: string | null;
  runGroupId?: string | null;
  queuePosition?: number | null;
  groupRemainingJobs?: number;
  canCancel?: boolean;
  agentSteps: AgentStep[];
  generatedTests: PersistedGeneratedTest[];
  tokenUsage: TokenUsage;
  usedOwnKeys: boolean;
}

export interface JobSummary {
  id: string;
  targetUrl: string;
  status: JobStatus;
  runGroupId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt: string | null;
  testCount: number;
  passedCount: number;
  failedCount: number;
  gaveUpCount: number;
  needsReviewCount?: number;
  healedCount?: number;
  tokensUsed?: number;
}

export interface JobsListResponse {
  jobs: JobSummary[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
