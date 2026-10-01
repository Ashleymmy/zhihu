const d = require('./domain')

// Income is a projection. Entries are immutable signed movements in yuan (4dp).
async function movements(tx, row) {
  const entries = await tx.find('income_entries', { incomeId: row.id })
  if (entries.length) return entries
  // Upgrade an existing projection without changing its financial meaning.
  return [{ id: d.hash(['opening', row.id]), incomeId: row.id, ...scopeOf(row),
    userId: row.userId, factId: row.factId, version: row.version,
    bucket: row.availability === 'available' ? 'available' : 'held', amount: row.amount, kind: 'opening' }]
}
const scopeOf = row => ({ projectId: row.projectId, accountId: row.accountId })
async function totals(tx, row) {
  const entries = await movements(tx, row)
  return entries.reduce((sum, entry) => { sum[entry.bucket] += d.cash(entry.amount, true); return sum }, { held: 0n, available: 0n })
}
async function persistOpening(tx, row) {
  if (!row) return
  for (const entry of await movements(tx, row)) {
    if (entry.kind === 'opening' && !await tx.get('income_entries', entry.id)) {
      await tx.put('income_entries', entry.id, { ...entry, createdAt: d.now() })
    }
  }
}
async function append(tx, row, eventId, bucket, amount, kind, operatorId) {
  if (!amount) return
  const id = d.hash([eventId, bucket])
  if (await tx.get('income_entries', id)) d.fail('账务事件已存在', 409)
  await tx.put('income_entries', id, { id, incomeId: row.id, ...scopeOf(row), userId: row.userId,
    factId: row.factId, version: row.version, bucket, amount: d.money(amount), kind, operatorId, createdAt: d.now() })
}
async function confirm(tx, scope, fact, operatorId) {
  for (const allocation of fact.allocations) {
    const id = d.hash([fact.id, allocation.userId]), previous = await tx.get('income', id)
    if (previous?.version === fact.version && previous.amount === allocation.amount) continue
    await persistOpening(tx, previous)
    const delta = d.cash(allocation.amount, true) - d.cash(previous?.amount || '0', true)
    const before = previous ? await totals(tx, previous) : { held: 0n, available: 0n }
    const held = delta >= 0n ? delta : -(before.held < -delta ? before.held : -delta)
    const available = delta - held
    const eventId = d.hash(['confirmation', fact.id, fact.version, allocation.userId])
    if (await tx.get('ledger', eventId)) d.fail('该版本已有账务记录，请核对账本', 409)
    const row = { id, ...scope, moduleId: 'zhihu', factId: fact.id, version: fact.version,
      userId: allocation.userId, amount: allocation.amount, entryId: eventId,
      availability: before.held + held > 0n ? 'held' : 'available', confirmedBy: operatorId, confirmedAt: d.now() }
    await append(tx, row, eventId, 'held', held, 'confirmation', operatorId)
    await append(tx, row, eventId, 'available', available, 'confirmation', operatorId)
    await tx.put('ledger', eventId, { id: eventId, ...scope, kind: 'confirmation', factId: fact.id,
      version: fact.version, userId: allocation.userId, previousAmount: previous?.amount || '0.0000',
      amount: allocation.amount, delta: d.money(delta), heldDelta: d.money(held), availableDelta: d.money(available),
      previousEntryId: previous?.entryId || null, operatorId, createdAt: d.now() })
    await tx.put('income', id, row)
  }
}
async function eligible(tx, row) {
  const fact = await tx.get('facts', row.factId), binding = fact?.bindingId ? await tx.get('bindings', fact.bindingId) : null
  return !!(fact && !fact.pendingRevision && !fact.error && fact.version === row.version && binding?.verificationStatus === 'passed' && !binding.disputed)
}
async function release(tx, row, operatorId, reference) {
  await persistOpening(tx, row)
  const value = (await totals(tx, row)).held
  if (value <= 0n || !await eligible(tx, row)) d.fail('该款项暂不可开放', 409)
  const eventId = d.hash(['funding', row.id, row.version])
  if (await tx.get('ledger', eventId)) d.fail('该版本款项已开放', 409)
  await append(tx, row, eventId, 'held', -value, 'funding', operatorId)
  await append(tx, row, eventId, 'available', value, 'funding', operatorId)
  await tx.put('ledger', eventId, { id: eventId, ...scopeOf(row), kind: 'funding', incomeId: row.id,
    userId: row.userId, amount: d.money(value), version: row.version, reference, operatorId, createdAt: d.now() })
  await tx.put('income', row.id, { ...row, availability: 'available', releasedBy: operatorId, releasedAt: d.now(), releaseReference: reference })
  return value
}
module.exports = { movements, totals, confirm, eligible, release }
