| Signal | Model |
| --- | --- |
| One package, established contract, deterministic mock and tests | smaller fast model |
| Repeated scenario additions following a reviewed pattern | smaller fast model |
| Product or package architecture, auth, money, live calls or persistence | frontier model and a decision pause |
| Oracle schema or reviewed truth semantics | frontier model |
| Adversarial review of cross-provider or write-boundary work | frontier model |

The default executor remains inline so repository context accumulates. Parallel work is
appropriate only for independent repeated scenario files; shared contracts, indexes,
oracle manifests and final gates stay with the orchestrator.
