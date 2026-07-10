# Vendored Poseidon2 (zkhash)

Copied from `packages/vendor/spp/poseidon2` (Nethermind SPP pin) so
`packages/spp-native` builds on EAS without uploading the full SPP submodule.

When bumping the SPP submodule, re-sync this tree if leaf/key-derive params change:

```text
robocopy packages\vendor\spp\poseidon2 packages\spp-native\vendor\poseidon2 /E /XD tests target
```

License: Apache-2.0 OR MIT (upstream).
