# Zero-knowledge direction

Veilpay includes ZK-oriented infrastructure and privacy-pool direction, but production private settlement requires careful gating.

## Current direction

- Groth16-style proof concepts.
- Nullifier-based double-spend prevention.
- Privacy pool patterns.
- Separate Stellar SPP circuit and native-proving path.

## Important boundary

ZK code and circuit scaffolding must not be presented as production-live private payments unless the full proving, verification, relayer, indexing, audit, and operational controls are complete.

## Production requirements

- External audit of circuits and contracts.
- Trusted setup or transparent proof system strategy appropriate to the deployed circuit.
- Nullifier correctness.
- Relayer abuse controls.
- Value caps.
- Kill-switch and incident response plan.
- Clear user recovery and note-secret handling.
