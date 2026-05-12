# Contributing

Thanks for your interest in contributing to Network Policy Editor.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/<owner>/network-policy-editor.git
cd network-policy-editor

# Start dev environment
docker compose up

# Or without Docker
npm install
npm run dev
```

The app runs at [http://localhost:5173](http://localhost:5173) with hot module replacement.

## Making Changes

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feat/my-feature`
3. **Make your changes** — follow the existing code style
4. **Test locally** — verify in both K8s and Cilium YAML modes
5. **Open a pull request** against `main`

## Code Style

- TypeScript strict mode (`noUncheckedIndexedAccess`, `noUnusedLocals`)
- Functional React components with hooks
- Tailwind CSS v4 with theme tokens (no hardcoded colors — use `text-text-primary`, `bg-card-bg`, etc.)
- State via `useReducer` + Context — no external state libraries
- TanStack Table for all tabular editors

## Project Layout

| Directory | Purpose |
|-----------|---------|
| `src/types/` | TypeScript interfaces (`PolicyState`, `PolicyRule`) |
| `src/state/` | Reducer, action creators, context provider |
| `src/lib/` | Pure functions — YAML generators, parsers, validators |
| `src/components/canvas/` | Visual editor components (columns, cards, arrows) |
| `src/components/editors/` | TanStack Table inline editors |
| `src/components/yaml/` | YAML panel, display, rating |
| `src/components/ui/` | Shared UI primitives |

## Adding a New Rule Type

1. Add the type to `RuleType` in `src/types/policy.ts`
2. Update the reducer in `src/state/reducer.ts`
3. Add sub-type options in `IngressColumn.tsx` / `EgressColumn.tsx`
4. Update `getSummary()` in both columns
5. Add editor fields in `RuleGroupCard.tsx`
6. Update both YAML generators (`yaml-gen-k8s.ts`, `yaml-gen-cilium.ts`)
7. Update both parsers in `yaml-parser.ts`

## Adding Theme Tokens

1. Add the CSS custom property in `src/index.css` under `@theme`
2. Define values in both `:root` (dark) and `[data-theme="light"]` blocks
3. Use the token class in components (e.g., `bg-my-token`)

## Commit Messages

Use concise, descriptive commit messages:

```
feat: add FQDN rule support for Cilium policies
fix: correct namespace label mapping in Cilium parser
docs: update README with Cilium features
```

## Reporting Issues

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser and OS
- YAML sample if relevant (for parser/generator bugs)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
