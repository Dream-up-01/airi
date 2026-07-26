# Stage Pages

Shared Vue page implementations used by AIRI Stage applications. Pages compose
business stores and reusable UI while leaving platform access behind injected
adapters.

## How to use

Import the required shared page from the package and provide any platform
adapter expected by that page. The AIRI Card settings page consumes the
companion preset file-reader injection and delegates validation, activation,
and rollback to `@proj-airi/stage-ui`.

## When to use it

Use this package for route-level or settings-page UI shared by Web and Electron,
including focused feature containers and their presentational components.

## When not to use it

Do not add Electron APIs, filesystem access, provider credentials, or core
companion policy here. Platform IO belongs to the app; reusable domain and
application state belong to `stage-ui`.
