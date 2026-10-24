package com.vault.service;

import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

/**
 * Session / passcode gate — Java port of gate.server.ts
 *
 * Session format: "unlocked.<timestamp>.<hmac_sha256_base64url>"
 * Cookie name: tfv_session
 * Max age: 15 minutes
 */
@Service
public class GateService {

    private static final String COOKIE_NAME = "tfv_session";
    private static final long MAX_AGE_MS = 15L * 60 * 1000; // 15 minutes

    public String cookieName() {
        return COOKIE_NAME;
    }

    /**
     * Returns a fresh signed session string (without setting the cookie —
     * controllers handle that).
     */
    public String issueSession() {
        String payload = "unlocked." + System.currentTimeMillis();
        String sig = sign(payload);
        return payload + "." + sig;
    }

    public boolean isValidSession(String raw) {
        if (raw == null || raw.isBlank()) return false;
        int idx = raw.lastIndexOf('.');
        if (idx < 0) return false;
        String payload = raw.substring(0, idx);
        String sig = raw.substring(idx + 1);
        String expected = sign(payload);

        // Timing-safe comparison
        byte[] a = sig.getBytes(StandardCharsets.UTF_8);
        byte[] b = expected.getBytes(StandardCharsets.UTF_8);
        if (a.length != b.length) return false;
        int diff = 0;
        for (int i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
        if (diff != 0) return false;

        if (!payload.startsWith("unlocked.")) return false;
        try {
            long issuedAt = Long.parseLong(payload.substring("unlocked.".length()));
            return System.currentTimeMillis() - issuedAt <= MAX_AGE_MS;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * Verifies the passcode (APP_PASSCODE env var) using constant-time comparison.
     */
    public boolean verifyPasscode(String input) {
        String expected = System.getProperty("APP_PASSCODE");
        if (expected == null || expected.isBlank()) return false;
        byte[] a = sha256(input);
        byte[] b = sha256(expected);
        return MessageDigest.isEqual(a, b);
    }

    private String sign(String value) {
        String secret = System.getProperty("SESSION_SECRET");
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("SESSION_SECRET environment variable is not set");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec keySpec = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(keySpec);
            byte[] hmac = mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac);
        } catch (Exception e) {
            throw new RuntimeException("HMAC signing failed", e);
        }
    }

    private byte[] sha256(String input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    public long maxAgeSeconds() {
        return MAX_AGE_MS / 1000;
    }
}
