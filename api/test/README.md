# API Tests

This directory contains tests for the PoB API backend.

## Test Structure

```
test/
├── db/
│   └── metadata.test.ts       # Database layer tests (IPFS cache functions)
└── api/
    └── batch-metadata.test.ts # API endpoint tests (batch metadata fetching)
```

## Running Tests

### Install Dependencies

First, install test dependencies:

```bash
cd api
npm install
```

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run Specific Test File

```bash
npm test -- test/db/metadata.test.ts
npm test -- test/api/batch-metadata.test.ts
```

## Test Coverage

### Database Tests (`test/db/metadata.test.ts`)

Tests for IPFS cache functionality in the metadata database:

✅ **Fully Implemented:**
- `cacheIPFSContent()` - Cache IPFS JSON content
- `getCachedIPFSContent()` - Retrieve single cached item
- `getBatchCachedIPFSContent()` - Batch retrieve cached items
- `deleteCachedIPFSContent()` - Delete cached content when unpinning

**Coverage:**
- Basic functionality
- Duplicate CID handling (ON CONFLICT DO NOTHING)
- Large content handling
- Special characters and edge cases
- Batch operations with 50+ items
- Integration with metadata updates
- Performance characteristics

### API Tests (`test/api/batch-metadata.test.ts`)

Tests for the batch metadata API endpoint (`POST /api/metadata/batch`):

✅ **Request Validation Tests:**
- Empty/missing cids array
- Non-array cids parameter
- Maximum 50 CIDs limit
- Invalid CID formats

⚠️ **Integration Tests (Placeholders):**
- Cache behavior verification
- IPFS fetch integration
- Error handling
- Concurrent requests
- Performance benchmarks

**Note:** Some API integration tests are currently placeholders. To fully implement them, you would need to:

1. Start a test API server instance
2. Mock the IPFS service
3. Mock the database layer
4. Test actual HTTP requests

## Test Philosophy

### Unit Tests (Database Layer)
- Test functions in isolation
- Use in-memory SQLite database
- No external dependencies
- Fast execution (< 1 second for all tests)

### Integration Tests (API Layer)
- Test HTTP endpoints with real database
- Mock external services (IPFS)
- Verify request/response formats
- Test error handling paths

### What's NOT Tested
- IPFS node connectivity (external dependency)
- Network failures (would require chaos engineering)
- Production database migrations (done manually)

## Writing New Tests

### Database Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createMetadataDatabase } from '../../src/db/metadata.js';

describe('Your Test Suite', () => {
  let db: Database.Database;
  let metadataDb: ReturnType<typeof createMetadataDatabase>;

  beforeEach(() => {
    db = new Database(':memory:');
    // Load schema...
    metadataDb = createMetadataDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should do something', () => {
    // Test code
  });
});
```

### API Tests

```typescript
import { describe, it, expect } from '@jest/globals';

describe('POST /api/your-endpoint', () => {
  it('should validate input', async () => {
    // Test validation logic
  });
});
```

## Continuous Integration

These tests should be run:
- Before every commit (pre-commit hook)
- On every pull request (CI/CD)
- Before deployment to production

## Troubleshooting

### Tests fail with "Cannot find module"
Make sure you've installed dependencies:
```bash
npm install
```

### SQLite errors
The tests use in-memory SQLite databases. If you see SQLite errors:
1. Check that `better-sqlite3` is installed
2. Verify the schema file exists at `src/db/schema.sql`

### Jest ESM issues
This project uses ES modules. Make sure:
1. `"type": "module"` is in package.json
2. Jest config has `preset: 'ts-jest/presets/default-esm'`
3. Files use `.js` extensions in imports

## Future Improvements

- [ ] Add integration tests with real IPFS node (optional, using testcontainers)
- [ ] Add E2E tests that test the full flow from frontend to backend
- [ ] Add performance benchmarks for batch operations
- [ ] Add load testing for concurrent requests
- [ ] Mock IPFS service for API integration tests
- [ ] Add test coverage reporting to CI/CD
