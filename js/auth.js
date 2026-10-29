// ============================================
// F1 PREDICTION LEAGUE — AUTH
// Login · Signup · Session · Error handling
// ============================================

import {
  auth,
  isAdmin,
  setAdminClaim,
  authReady,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  sendEmailVerification,
  linkWithCredential,
  setDocument,
  getDocument
} from './firebase.js';
import { renderAuthShell } from './auth-view.js';
import { escapeHTML, icon } from './design.js';
import { seedData } from './seed.js';
import { navigateTo, showToast, openSidePanel, closeSidePanel } from './ui.js';
import { initChat, cleanupChat } from './chat.js';

// --- State ---
let authUnsubscribe = null;

let isAuthReady = false;
let pendingGoogleCredential = null;

function isEmailVerified(user) {
  return Boolean(user?.emailVerified || user?.providerData?.some(p => p.providerId === 'google.com'));
}

async function refreshAdminClaim(user) {
  if (!user) {
    setAdminClaim(false);
    return;
  }
  try {
    const token = await user.getIdTokenResult();
    setAdminClaim(token.claims?.admin === true);
  } catch (error) {
    setAdminClaim(false);
    console.warn('[Auth] Could not read authorization claims:', error.code || error.message);
  }
}

async function ensureUserProfile(user) {
  const existing = await getDocument('users', user.uid);
  if (!existing) {
    await setDocument('users', user.uid, {
      displayName: user.displayName || user.email?.split('@')[0] || 'Driver',
      seasonPoints: 0,
      lastEventScore: 0,
      wins: 0
    });
  }
}

/**
 * Initialize auth state listener
 * Called once on app startup
 */
function initAuth(onReady) {
  authReady.then(() => getRedirectResult(auth)).catch((error) => {
    if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) {
      console.warn('[Auth] Google redirect sign-in did not complete:', error.code || error.message);
      if (error.code === 'auth/unauthorized-domain') {
        showToast('This domain must be added to Firebase Authentication authorized domains.', 'error', 6000);
      }
    }
  });
  authUnsubscribe = onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log('[Auth] User signed in:', user.email);

      await refreshAdminClaim(user);

      // Update UI immediately
      updateAuthUI(user);
      
      // Notify ready immediately so router renders target page without waiting for Firestore queries
      if (!isAuthReady) {
        isAuthReady = true;
        if (onReady) onReady();
      }

      // Navigate to dashboard if on auth page or root
      if (window.location.hash === '' || window.location.hash === '#auth') {
        navigateTo(new URLSearchParams(location.search).has('roomInvite') ? 'rooms' : 'dashboard');
      }

      // Initialize global chat
      initChat(user);

      // Non-blocking background sync for user doc & seed data
      (async () => {
        try {
          await ensureUserProfile(user);
          if (isAdmin()) {
            await seedData();
          }
        } catch (err) {
          console.error('[Auth] Background sync error:', err);
        }
      })();
    } else {
      console.log('[Auth] User signed out');
      setAdminClaim(false);
      updateAuthUI(null);
      // Hide UI elements
      cleanupChat();
      navigateTo('auth');

      if (!isAuthReady) {
        isAuthReady = true;
        if (onReady) onReady();
      }
    }
  });
}

/**
 * Update header and nav UI based on auth state
 * @param {Object|null} user 
 */
function updateAuthUI(user) {
  const headerNav = document.getElementById('header-nav');
  const headerActions = document.getElementById('header-actions');
  const appHeader = document.getElementById('app-header');

  if (user) {
    if (appHeader) appHeader.classList.remove('hidden');
    if (headerActions) {
      const displayName = escapeHTML(user.displayName || user.email.split('@')[0]);
      headerActions.innerHTML = `
        <button class="header-user profile-trigger" id="btn-profile" type="button" aria-label="Edit profile"><span class="user-avatar">${displayName.slice(0, 1)}</span>
          <span class="text-body-sm">${displayName}</span>
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-signout" aria-label="Sign out">
          Sign out
        </button>
      `;
      document.getElementById('btn-signout')?.addEventListener('click', handleSignOut);
      document.getElementById('btn-profile')?.addEventListener('click', openProfilePanel);
      renderVerificationNotice(user);
    }
  } else {
    if (appHeader) appHeader.classList.add('hidden');
  }
}

/**
 * Render the auth screen
 */
function renderAuthScreen() {
  const page = document.getElementById('auth-page');
  if (!page) return;

  renderAuthShell(true);

  // --- Event Listeners ---
  let isSignUp = false;
  const form = document.getElementById('auth-form');
  const toggleBtn = document.getElementById('auth-toggle');
  const submitBtn = document.getElementById('auth-submit');
  const nameGroup = document.getElementById('name-group');
  const passwordInput = document.getElementById('auth-password');
  const googleButton = document.getElementById('google-auth');

  toggleBtn.addEventListener('click', () => {
    isSignUp = !isSignUp;
    nameGroup.classList.toggle('hidden', !isSignUp);
    submitBtn.innerHTML = `<span>${isSignUp ? 'Join the grid' : 'Enter the paddock'}</span>${icon('arrow')}`;
    toggleBtn.innerHTML = `${isSignUp ? 'Sign in' : 'Create an account'} ${icon('arrow', 'diagonal-arrow')}`;
    document.getElementById('auth-title').innerHTML = isSignUp ? 'Your season.<br>Your story.' : 'Welcome to<br>the paddock.';
    document.getElementById('auth-description').textContent = isSignUp ? 'Join the league. Make your first prediction.' : 'Your next winning prediction starts here.';
    document.getElementById('auth-switch-label').textContent = isSignUp ? 'Already on the grid?' : 'New to the grid?';
    document.querySelector('.form-number').textContent = isSignUp ? '02 / JOIN THE GRID' : '01 / SIGN IN';
    passwordInput.autocomplete = isSignUp ? 'new-password' : 'current-password';
    clearErrors();
  });

  document.getElementById('password-toggle').addEventListener('click', (event) => {
    const visible = passwordInput.type === 'password';
    passwordInput.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  });

  document.getElementById('auth-reset').addEventListener('click', handlePasswordReset);
  googleButton.addEventListener('click', handleGoogleSignIn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value.trim();

    // Validation
    if (!email) {
      showFieldError('email', 'Email is required');
      return;
    }
    if (!document.getElementById('auth-email').validity.valid) {
      showFieldError('email', 'Enter a valid email address');
      return;
    }
    if (!password || password.length < 6) {
      showFieldError('password', 'Password must be at least 6 characters');
      return;
    }
    if (isSignUp && !name) {
      showFieldError('name', 'Display name is required');
      return;
    }

    // Disable button and show spinner
    submitBtn.disabled = true;
    toggleBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span>';

    try {
      if (isSignUp) {
        await handleCreateAccount(email, password, name);
      } else {
        await handleSignIn(email, password);
      }
    } catch (error) {
      handleAuthError(error);
      // Shake the card
      const card = document.getElementById('auth-card');
      card.classList.add('animate-shake');
      setTimeout(() => card.classList.remove('animate-shake'), 500);
    } finally {
      submitBtn.disabled = false;
      toggleBtn.disabled = false;
      submitBtn.innerHTML = `<span>${isSignUp ? 'Join the grid' : 'Enter the paddock'}</span>${icon('arrow')}`;
    }
  });
}

/**
 * Handle sign in
 */
async function handleSignIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  if (pendingGoogleCredential && auth.currentUser) {
    await linkPendingGoogleCredential();
  }
  showToast('Welcome back!', 'success');
}

/**
 * Handle account creation
 */
async function handleCreateAccount(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  
  // Set display name
  await updateProfile(credential.user, { displayName });
  
  // Create user document (without leaking raw email)
  await setDocument('users', credential.user.uid, {
    displayName,
    seasonPoints: 0,
    lastEventScore: 0,
    wins: 0
  });

  await sendEmailVerification(credential.user);

  showToast('Account created! Check your email to verify your account.', 'success');
}

async function handleGoogleSignIn() {
  const button = document.getElementById('google-auth');
  if (button) {
    button.disabled = true;
    button.dataset.previousLabel = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span><span>Connecting to Google…</span>';
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await authReady;
    await signInWithPopup(auth, provider);
    showToast('Welcome to the paddock!', 'success');
  } catch (error) {
    if (error.code === 'auth/account-exists-with-different-credential') {
      pendingGoogleCredential = error.credential || GoogleAuthProvider.credentialFromError(error) || null;
      const email = error.customData?.email || 'that email address';
      showFieldError('email', `An account already exists for ${email}. Sign in with its existing method to link Google safely.`);
      document.getElementById('auth-email')?.focus();
    } else if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(error.code)) {
      await signInWithRedirect(auth, provider);
    } else if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
      handleAuthError(error);
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = button.dataset.previousLabel || '<span class="google-mark">G</span><span>Continue with Google</span>';
    }
  }
}

async function linkPendingGoogleCredential() {
  if (!pendingGoogleCredential || !auth.currentUser) return;
  try {
    await linkWithCredential(auth.currentUser, pendingGoogleCredential);
    pendingGoogleCredential = null;
    showToast('Google sign-in linked to your account.', 'success');
  } catch (error) {
    pendingGoogleCredential = null;
    if (error.code !== 'auth/provider-already-linked') throw error;
  }
}

async function handlePasswordReset() {
  clearErrors();
  const emailInput = document.getElementById('auth-email');
  const email = emailInput?.value.trim();
  if (!email) {
    showFieldError('email', 'Enter your email address first');
    return;
  }
  if (!emailInput.validity.valid) {
    showFieldError('email', 'Enter a valid email address');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Password reset email sent. Check your inbox.', 'success', 5000);
  } catch (error) {
    handleAuthError(error);
  }
}

async function handleResendVerification() {
  try {
    await sendEmailVerification(auth.currentUser);
    showToast('Verification email sent again.', 'success');
  } catch (error) {
    handleAuthError(error);
  }
}

function renderVerificationNotice(user) {
  const headerActions = document.getElementById('header-actions');
  if (!headerActions || isEmailVerified(user)) return;
  const notice = document.createElement('button');
  notice.type = 'button';
  notice.className = 'btn btn-ghost btn-sm verification-reminder';
  notice.textContent = 'Verify email';
  notice.addEventListener('click', handleResendVerification);
  headerActions.prepend(notice);
}

function openProfilePanel() {
  const user = auth.currentUser;
  if (!user) return;
  openSidePanel(`
    <div class="side-panel-header"><h2 class="text-display-sm">Your profile</h2><button class="btn btn-icon btn-ghost" id="close-profile" aria-label="Close profile">✕</button></div>
    <div class="side-panel-body">
      <form id="profile-form">
        <div class="form-group"><label class="form-label" for="profile-display-name">Display name</label><input class="form-input" id="profile-display-name" maxlength="60" required value="${escapeHTML(user.displayName || '')}"></div>
        <p class="text-muted">Your identity is tied to your Firebase UID. Changing this name does not change your account.</p>
        <button class="btn btn-primary" type="submit">Save profile</button>
      </form>
    </div>
  `);
  document.getElementById('close-profile')?.addEventListener('click', closeSidePanel);
  document.getElementById('profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('profile-display-name').value.trim();
    if (!name) return;
    try {
      await updateProfile(user, { displayName: name });
      await setDocument('users', user.uid, { displayName: name }, true);
      updateAuthUI(user);
      closeSidePanel();
      showToast('Profile updated.', 'success');
    } catch (error) {
      showToast('Could not update your profile.', 'error');
    }
  });
}

/**
 * Handle sign out
 */
async function handleSignOut() {
  try {
    try {
      localStorage.removeItem('f1_auth_state');
    } catch (e) {}
    await firebaseSignOut(auth);
    showToast('Signed out', 'info');
  } catch (error) {
    console.error('[Auth] Sign out error:', error);
    showToast('Failed to sign out', 'error');
  }
}

/**
 * Handle Firebase auth errors with user-friendly messages
 */
function handleAuthError(error) {
  const code = error.code;
  
  const messages = {
    'auth/invalid-email': { field: 'email', message: 'Invalid email address' },
    'auth/user-disabled': { field: 'email', message: 'This account has been disabled' },
    'auth/user-not-found': { field: 'email', message: 'No account found with this email' },
    'auth/wrong-password': { field: 'password', message: 'Incorrect password' },
    'auth/invalid-credential': { field: 'password', message: 'Invalid email or password' },
    'auth/email-already-in-use': { field: 'email', message: 'This email is already registered' },
    'auth/weak-password': { field: 'password', message: 'Password is too weak — use 6+ characters' },
    'auth/too-many-requests': { field: 'email', message: 'Too many attempts. Try again later.' },
    'auth/network-request-failed': { field: 'email', message: 'Network error. Check your connection.' },
    'auth/unauthorized-domain': { field: 'email', message: 'This site is not authorized for Google sign-in yet.' },
    'auth/popup-blocked': { field: 'email', message: 'Your browser blocked the Google sign-in popup. Try again or allow popups.' },
    'auth/popup-closed-by-user': { field: 'email', message: 'Google sign-in was cancelled.' },
    'auth/requires-recent-login': { field: 'email', message: 'Please sign in again before changing this account.' },
    'auth/user-token-expired': { field: 'email', message: 'Your session expired. Please sign in again.' },
  };

  const mapped = messages[code] || { field: 'email', message: 'Something went wrong. Try again.' };
  showFieldError(mapped.field, mapped.message);
}

/**
 * Show error message under a form field
 */
function showFieldError(field, message) {
  const errorEl = document.getElementById(`${field}-error`);
  const inputEl = document.getElementById(`auth-${field}`);
  if (errorEl) {
    errorEl.textContent = `⚠ ${message}`;
    errorEl.classList.remove('hidden');
  }
  if (inputEl) {
    inputEl.classList.add('error');
    inputEl.setAttribute('aria-invalid', 'true');
    inputEl.focus();
  }
}

/**
 * Clear all field errors
 */
function clearErrors() {
  const errors = document.querySelectorAll('.form-error');
  const inputs = document.querySelectorAll('.form-input');
  errors.forEach(el => {
    el.classList.add('hidden');
    el.textContent = '';
  });
  inputs.forEach(el => { el.classList.remove('error'); el.removeAttribute('aria-invalid'); });
}

/**
 * Get current user
 * @returns {Object|null}
 */
function getCurrentUser() {
  return auth.currentUser;
}

// --- Exports ---
export {
  initAuth,
  renderAuthScreen,
  getCurrentUser,
  handleSignOut,
  handleGoogleSignIn,
  handlePasswordReset,
  handleResendVerification
};
