#!/usr/bin/env tsx
/**
 * Generate synthetic process mining test data with 1024-d embeddings
 */

import { DuckDBService } from '../src/duckdb/service.js'

// Generate random 1024-dimensional embedding
function generateEmbedding1024(): number[] {
  const embedding = new Array(1024)
  for (let i = 0; i < 1024; i++) {
    // Generate random values between -1 and 1 with some structure
    embedding[i] = (Math.random() - 0.5) * 2 * Math.exp(-i / 500)
  }
  // Normalize to unit length
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  return embedding.map((val) => val / magnitude)
}

async function generateTestData() {
  const duckdb = new DuckDBService()
  await duckdb.initialize()

  console.log('🔧 Generating Process Mining Test Data with 1024-d Embeddings\n')

  try {
    // 1. Generate process_summary (3 processes)
    console.log('📊 Generating process_summary.parquet...')
    await duckdb.executeQuery(`
      COPY (
        SELECT * FROM (VALUES
          ('doc1', 'proc1', 'Onboarding', 'User onboarding workflow', 5, 0.95, NULL),
          ('doc2', 'proc2', 'Order Fulfillment', 'E-commerce order processing', 6, 0.92, NULL),
          ('doc3', 'proc3', 'Support Ticket', 'Customer support ticket resolution', 4, 0.88, NULL)
        ) AS t(doc_id, process_id, type, one_liner, steps_count, confidence, mermaid)
      ) TO 'test-data/process/process_summary.parquet' (FORMAT PARQUET)
    `)
    console.log('✅ process_summary.parquet created')

    // 2. Generate process_steps with 1024-d embeddings
    console.log('\n📊 Generating process_steps.parquet with 1024-d embeddings...')

    const steps = [
      // Process 1: Onboarding (5 steps)
      { doc_id: 'doc1', process_id: 'proc1', step_id: 'step1', order: 0, step_key: 'login', label: 'User Login', evidence: 'User enters credentials' },
      { doc_id: 'doc1', process_id: 'proc1', step_id: 'step2', order: 1, step_key: 'verify', label: 'Verify Identity', evidence: 'System verifies user' },
      { doc_id: 'doc1', process_id: 'proc1', step_id: 'step3', order: 2, step_key: 'profile', label: 'Complete Profile', evidence: 'User fills profile' },
      { doc_id: 'doc1', process_id: 'proc1', step_id: 'step4', order: 3, step_key: 'welcome', label: 'Send Welcome Email', evidence: 'System sends email' },
      { doc_id: 'doc1', process_id: 'proc1', step_id: 'step5', order: 4, step_key: 'activate', label: 'Activate Account', evidence: 'Account activated' },

      // Process 2: Order Fulfillment (6 steps)
      { doc_id: 'doc2', process_id: 'proc2', step_id: 'step1', order: 0, step_key: 'Login', label: 'Customer Login', evidence: 'Customer logs in' },
      { doc_id: 'doc2', process_id: 'proc2', step_id: 'step2', order: 1, step_key: 'cart', label: 'Add to Cart', evidence: 'Items added' },
      { doc_id: 'doc2', process_id: 'proc2', step_id: 'step3', order: 2, step_key: 'checkout', label: 'Checkout', evidence: 'Payment processed' },
      { doc_id: 'doc2', process_id: 'proc2', step_id: 'step4', order: 3, step_key: 'Verify', label: 'Verify Order', evidence: 'Order verified' },
      { doc_id: 'doc2', process_id: 'proc2', step_id: 'step5', order: 4, step_key: 'ship', label: 'Ship Order', evidence: 'Package shipped' },
      { doc_id: 'doc2', process_id: 'proc2', step_id: 'step6', order: 5, step_key: 'deliver', label: 'Deliver', evidence: 'Package delivered' },

      // Process 3: Support Ticket (4 steps, includes orphan step for testing)
      { doc_id: 'doc3', process_id: 'proc3', step_id: 'step1', order: 0, step_key: 'create', label: 'Create Ticket', evidence: 'User creates ticket' },
      { doc_id: 'doc3', process_id: 'proc3', step_id: 'step2', order: 1, step_key: 'assign', label: 'Assign Agent', evidence: 'Ticket assigned' },
      { doc_id: 'doc3', process_id: 'proc3', step_id: 'step3', order: 2, step_key: 'resolve', label: 'Resolve Issue', evidence: 'Issue resolved' },
      { doc_id: 'doc3', process_id: 'proc3', step_id: 'step4', order: 3, step_key: 'orphan_step', label: 'Orphan Step', evidence: 'No edges (for testing)' },
    ]

    // Build SQL with embeddings
    const stepsValues = steps.map((step) => {
      const embedding = generateEmbedding1024()
      const embeddingStr = '[' + embedding.join(',') + ']'
      return `('${step.doc_id}', '${step.process_id}', '${step.step_id}', ${step.order}, '${step.step_key}', '${step.label}', '${step.evidence}', ${embeddingStr}::DOUBLE[1024])`
    }).join(',\n')

    await duckdb.executeQuery(`
      COPY (
        SELECT * FROM (VALUES
          ${stepsValues}
        ) AS t(doc_id, process_id, step_id, "order", step_key, label, evidence, embedding)
      ) TO 'test-data/process/process_steps.parquet' (FORMAT PARQUET)
    `)
    console.log(`✅ process_steps.parquet created with ${steps.length} steps (1024-d embeddings)`)

    // 3. Generate process_edges (with cycle and duplicate for testing)
    console.log('\n📊 Generating process_edges.parquet...')
    await duckdb.executeQuery(`
      COPY (
        SELECT * FROM (VALUES
          -- Process 1 edges
          ('doc1', 'proc1', 'step1', 'step2', 'next', 'Sequential flow'),
          ('doc1', 'proc1', 'step2', 'step3', 'next', 'Sequential flow'),
          ('doc1', 'proc1', 'step3', 'step4', 'next', 'Sequential flow'),
          ('doc1', 'proc1', 'step4', 'step5', 'next', 'Sequential flow'),

          -- Process 2 edges (includes cycle for testing)
          ('doc2', 'proc2', 'step1', 'step2', 'next', 'Sequential flow'),
          ('doc2', 'proc2', 'step2', 'step3', 'next', 'Sequential flow'),
          ('doc2', 'proc2', 'step3', 'step4', 'next', 'Sequential flow'),
          ('doc2', 'proc2', 'step4', 'step5', 'next', 'Sequential flow'),
          ('doc2', 'proc2', 'step5', 'step6', 'next', 'Sequential flow'),
          ('doc2', 'proc2', 'step4', 'step3', 'retry', 'Cycle for testing QA'),
          ('doc2', 'proc2', 'step2', 'step3', 'duplicate', 'Duplicate edge for testing'),

          -- Process 3 edges (orphan step has no edges)
          ('doc3', 'proc3', 'step1', 'step2', 'next', 'Sequential flow'),
          ('doc3', 'proc3', 'step2', 'step3', 'next', 'Sequential flow')
        ) AS t(doc_id, process_id, from_step_id, to_step_id, relation, evidence)
      ) TO 'test-data/process/process_edges.parquet' (FORMAT PARQUET)
    `)
    console.log('✅ process_edges.parquet created (includes cycle + duplicate + orphan)')

    // 4. Generate process_signatures with 1024-d embeddings
    console.log('\n📊 Generating process_signatures.parquet with 1024-d embeddings...')

    const signatures = [
      { doc_id: 'doc1', process_id: 'proc1', signature_emb: generateEmbedding1024() },
      { doc_id: 'doc2', process_id: 'proc2', signature_emb: generateEmbedding1024() },
      { doc_id: 'doc3', process_id: 'proc3', signature_emb: generateEmbedding1024() },
    ]

    const signaturesValues = signatures.map((sig) => {
      const embeddingStr = '[' + sig.signature_emb.join(',') + ']'
      return `('${sig.doc_id}', '${sig.process_id}', ${embeddingStr}::DOUBLE[1024])`
    }).join(',\n')

    await duckdb.executeQuery(`
      COPY (
        SELECT * FROM (VALUES
          ${signaturesValues}
        ) AS t(doc_id, process_id, signature_emb)
      ) TO 'test-data/process/process_signatures.parquet' (FORMAT PARQUET)
    `)
    console.log('✅ process_signatures.parquet created with 3 signatures (1024-d embeddings)')

    console.log('\n✅ All test data generated successfully!')
    console.log('\n📊 Summary:')
    console.log('  - 3 processes (Onboarding, Order Fulfillment, Support Ticket)')
    console.log('  - 15 steps with 1024-d embeddings')
    console.log('  - 13 edges (includes cycle, duplicate, orphan step for testing)')
    console.log('  - 3 process signatures with 1024-d embeddings')
    console.log('\n🧪 Test Scenarios Included:')
    console.log('  - Step normalization: "login" vs "Login"')
    console.log('  - Conflict resolution: "Verify" vs "verify" (different orders)')
    console.log('  - Cycle detection: step4 → step3 (retry edge)')
    console.log('  - Duplicate edge: step2 → step3 (appears twice)')
    console.log('  - Orphan step: step4 in proc3 (no edges)')
  } finally {
    await duckdb.close()
  }
}

generateTestData().catch(console.error)
