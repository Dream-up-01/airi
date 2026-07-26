# Stage UI

Shared core for stage. Use this package for stage business components, stores,
provider orchestration, and runtime-neutral stage domain rules.

## Domain modules

- `@proj-airi/stage-ui/domains/companion`: validates and normalizes versioned,
  secret-free companion presets before application code converts them into an
  AIRI/CCv3 card. Use it after YAML/JSON parsing and before activation. Do not
  use it for file IO, Electron IPC, provider credentials, or presentation state.

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`
