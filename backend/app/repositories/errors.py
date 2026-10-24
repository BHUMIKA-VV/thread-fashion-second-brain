class RepositoryError(Exception):
    """Base class for data-layer errors that map to client-facing HTTP errors."""

    def __init__(self, message: str, details: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.details = details


class NotFoundError(RepositoryError):
    """The row does not exist OR belongs to another user (deliberately indistinguishable)."""


class ConflictError(RepositoryError):
    """A uniqueness rule was violated, e.g. a duplicate collection name."""
