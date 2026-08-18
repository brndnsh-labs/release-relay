| Label | Meaning |
| --- | --- |
| `enhancement` | A new product or developer capability. |
| `bug` | Shipped behavior contradicts a reviewed contract; reproduce before fixing. |
| `documentation` | Documentation-only work. |
| `security` | Credentials, auth, data egress, webhook trust, remote writes, money or retention. Read `docs/security.md` first. |
| `area:foundation` | Toolchain, core contracts, mock runtime or workflow infrastructure. |
| `area:github` | GitHub reads, webhooks or explicitly confirmed publication. |
| `area:ai` | OpenAI or Anthropic drafting, review, validation and provenance. |
| `area:billing` | Stripe and sponsor-membership behavior. |
| `area:coverage` | Scenario source, oracle data and Breakscope comparison. |
| `area:operations` | CI, canary runs, release process or future environments. |
| `size:S` | Expected to fit one focused small-model cycle with a narrow diff. |
| `size:M` | Still one cycle, but crosses a package boundary or has a larger contract surface. |

Exactly one `area:*` and one `size:*` label should normally be present. Status labels
describe routing, not severity.
