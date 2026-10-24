// Wrapper to set minimal DB env vars before loading testPredeploy
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.DIRECT_URL = 'postgresql://user:pass@localhost:5432/db';

// Import the test suite (its top-level code runs immediately)
import './testPredeploy.ts';
