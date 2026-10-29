"""Sign-up, sign-in and account management (/auth)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import ClientIp, CurrentUser, OptionalUser, get_auth_service
from app.models import User
from app.schemas.auth import (
    Accepted,
    ChangePassword,
    ConfirmPassword,
    EmailOnly,
    Me,
    ResetPassword,
    SignIn,
    SignUp,
    TokenOnly,
)
from app.services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

Auth = Annotated[AuthService, Depends(get_auth_service)]


def set_session_cookie(response: Response, auth: AuthService, token: str) -> None:
    settings = auth.settings
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_days * 24 * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, auth: AuthService) -> None:
    settings = auth.settings
    response.delete_cookie(
        settings.session_cookie_name,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def me_for(auth: AuthService, user_id: object) -> Me:
    user = auth.db.get_one(User, user_id)
    return Me(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        email_verified=user.email_verified_at is not None,
        is_owner=user.is_owner,
        has_password=user.password_hash is not None,
    )


@router.get("/me", response_model=Me, responses={401: {"description": "not_signed_in"}})
def me(user: CurrentUser, auth: Auth) -> Me:
    out = me_for(auth, user.id)
    # The local development auto sign-in acts as the owner even before it is claimed.
    return out.model_copy(update={"is_owner": user.is_owner, "email_verified": user.email_verified})


@router.post("/signup", response_model=Accepted, status_code=status.HTTP_202_ACCEPTED)
def sign_up(body: SignUp, auth: Auth, ip: ClientIp) -> Accepted:
    """Create an account and email a verification link. Answers the same way whether or not
    the address already has an account (that person gets a different email)."""
    auth.sign_up(body.email, body.password, body.display_name, ip)
    return Accepted()


@router.post(
    "/login",
    response_model=Me,
    responses={401: {"description": "invalid_credentials"}, 429: {"description": "rate_limited"}},
)
def sign_in(body: SignIn, request: Request, response: Response, auth: Auth, ip: ClientIp) -> Me:
    token = auth.sign_in(body.email, body.password, ip, request.headers.get("user-agent"))
    set_session_cookie(response, auth, token)
    principal = auth.principal_for_token(token)
    assert principal is not None  # noqa: S101
    return me_for(auth, principal.id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(request: Request, auth: Auth) -> Response:
    token = request.cookies.get(auth.settings.session_cookie_name)
    if token:
        auth.sign_out(token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, auth)
    return response


@router.post("/logout-everywhere", status_code=status.HTTP_204_NO_CONTENT)
def sign_out_everywhere(user: CurrentUser, auth: Auth) -> Response:
    auth.sign_out_everywhere(user)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, auth)
    return response


@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
def verify_email(body: TokenOnly, auth: Auth) -> Response:
    auth.verify_email(body.token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/resend-verification", response_model=Accepted, status_code=202)
def resend_verification(user: CurrentUser, auth: Auth) -> Accepted:
    auth.resend_verification(user)
    return Accepted()


@router.post("/forgot-password", response_model=Accepted, status_code=202)
def forgot_password(body: EmailOnly, auth: Auth, ip: ClientIp) -> Accepted:
    auth.forgot_password(body.email, ip)
    return Accepted()


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(body: ResetPassword, auth: Auth) -> Response:
    """Set a new password from an emailed link. Signs the account out everywhere."""
    auth.reset_password(body.token, body.password)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, auth)
    return response


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: ChangePassword, user: CurrentUser, auth: Auth) -> Response:
    auth.change_password(user, body.current_password, body.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: ConfirmPassword, user: CurrentUser, auth: Auth) -> Response:
    """Permanently delete this account, its pieces, collections and image files."""
    auth.delete_account(user, body.password)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, auth)
    return response


@router.get("/session", response_model=Me | None)
def session(user: OptionalUser, auth: Auth) -> Me | None:
    """Like /auth/me, but answers null instead of 401 when nobody is signed in."""
    if user is None:
        return None
    out = me_for(auth, user.id)
    return out.model_copy(update={"is_owner": user.is_owner, "email_verified": user.email_verified})
