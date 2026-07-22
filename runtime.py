"""Request-scoped runtime state for agent execution (Streamlit or API)."""

from __future__ import annotations

from typing import Any, Callable, Optional

_current_runtime: Optional["RuntimeContext"] = None


class RuntimeContext:
    def __init__(
        self,
        on_display: Optional[Callable[[dict], None]] = None,
        show_internal_thoughts: bool = False,
        use_gpt4v: bool = False,
        attached_guardrails: Optional[list] = None,
        on_event: Optional[Callable[[str, dict], None]] = None,
        guardrail_prompt_addon: str = "",
        semantic_prompt_addon: str = "",
        user_profile: Any = None,
        resolved_metric: Any = None,
        compiled_query: Any = None,
    ):
        self._store: dict[str, Any] = {}
        self.show_internal_thoughts = show_internal_thoughts
        self.use_gpt4v = use_gpt4v
        self.on_display = on_display
        self.attached_guardrails = attached_guardrails or []
        self.on_event = on_event
        self.guardrail_prompt_addon = guardrail_prompt_addon
        self.semantic_prompt_addon = semantic_prompt_addon
        self.user_profile = user_profile
        self.resolved_metric = resolved_metric
        self.compiled_query = compiled_query

    def __getitem__(self, key: str) -> Any:
        return self._store[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self._store[key] = value

    def __contains__(self, key: str) -> bool:
        return key in self._store

    def get(self, key: str, default: Any = None) -> Any:
        return self._store.get(key, default)

    def keys(self):
        return self._store.keys()

    def items(self):
        return self._store.items()

    def __delitem__(self, key: str) -> None:
        del self._store[key]

    def pop(self, key: str, default: Any = None) -> Any:
        return self._store.pop(key, default)


class StreamlitRuntimeAdapter:
    """Adapts streamlit session_state to the runtime interface."""

    def __init__(self, session_state):
        self._session_state = session_state

    def __getitem__(self, key: str) -> Any:
        return self._session_state[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self._session_state[key] = value

    def __contains__(self, key: str) -> bool:
        return key in self._session_state

    def get(self, key: str, default: Any = None) -> Any:
        return self._session_state.get(key, default)

    def keys(self):
        return self._session_state.keys()

    def items(self):
        return self._session_state.items()

    def __delitem__(self, key: str) -> None:
        del self._session_state[key]

    def pop(self, key: str, default: Any = None) -> Any:
        return self._session_state.pop(key, default)

    @property
    def show_internal_thoughts(self) -> bool:
        return self._session_state.get("show_internal_thoughts", False)

    @property
    def use_gpt4v(self) -> bool:
        return self._session_state.get("use_gpt4v", False)


def set_runtime(ctx: RuntimeContext | StreamlitRuntimeAdapter | None) -> None:
    global _current_runtime
    _current_runtime = ctx


def get_runtime() -> RuntimeContext | StreamlitRuntimeAdapter:
    global _current_runtime
    if _current_runtime is not None:
        return _current_runtime
    try:
        import streamlit as st

        return StreamlitRuntimeAdapter(st.session_state)
    except Exception:
        return RuntimeContext()
