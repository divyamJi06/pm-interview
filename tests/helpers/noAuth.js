// Most tests here are about the interview engine, not about who is calling it, so
// they inject a verifier that is permanently disabled. It is hand-written rather
// than built from createUserVerifier so it cannot be reconnected by an ambient
// SUPABASE_* variable: with the real keys in .env, a verifier built from the
// environment would start rejecting every request in the suite with a 401.
module.exports = function noAuth() {
  const state = () => ({ configured: false, enforced: false, cacheSize: 0 });
  return {
    configured: false,
    async verify() {
      return { ok: true, userId: null, email: null, enforced: false };
    },
    state,
  };
};