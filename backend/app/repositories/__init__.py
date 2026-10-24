"""Data access, always scoped to one owner.

Each repository is constructed with the current user's id and adds it to every query,
so a caller cannot forget the ownership filter. Repositories flush but never commit:
the request (or worker job) owns the transaction.
"""
