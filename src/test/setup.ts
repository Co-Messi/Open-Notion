import 'fake-indexeddb/auto';

// Storage is not cleared globally between tests: the store treats a doc that vanished from
// storage as another tab's action and goes read only, which is the behaviour users need.
// Tests that need empty storage clear it themselves and load a fresh store with
// vi.resetModules() and a dynamic import.
