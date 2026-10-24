package com.vault.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.vault.service.GateService;
import com.vault.service.TelegramService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Auth endpoints: /api/unlock, /api/lock, /api/whoami, /api/status
 * Ports: api/unlock.ts, api/lock.ts, api/whoami.ts, api/status.ts
 */
@RestController
@RequestMapping("/api")
public class AuthController {

    private final GateService gateService;
    private final TelegramService telegramService;

    public AuthController(GateService gateService, TelegramService telegramService) {
        this.gateService = gateService;
        this.telegramService = telegramService;
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, String>> status() {
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @PostMapping("/unlock")
    public ResponseEntity<?> unlock(
            @RequestBody Map<String, String> body,
            HttpServletRequest request,
            HttpServletResponse response) {

        String passcode = body.getOrDefault("passcode", "");
        if (!gateService.verifyPasscode(passcode)) {
            return ResponseEntity.status(401).body(Map.of("error", "wrong passcode"));
        }

        String session = gateService.issueSession();
        boolean secure = isSecure(request);

        Cookie cookie = new Cookie(gateService.cookieName(), session);
        cookie.setHttpOnly(true);
        cookie.setSecure(secure);
        cookie.setPath("/");
        cookie.setMaxAge((int) gateService.maxAgeSeconds());
        if (secure) cookie.setAttribute("SameSite", "None");
        else cookie.setAttribute("SameSite", "Lax");
        response.addCookie(cookie);

        return ResponseEntity.ok(Map.of("ok", true));
    }

    @PostMapping("/lock")
    public ResponseEntity<?> lock(HttpServletRequest request, HttpServletResponse response) {
        boolean secure = isSecure(request);

        Cookie cookie = new Cookie(gateService.cookieName(), "");
        cookie.setHttpOnly(true);
        cookie.setSecure(secure);
        cookie.setPath("/");
        cookie.setMaxAge(0);
        response.addCookie(cookie);

        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/whoami")
    public ResponseEntity<?> whoami(HttpServletRequest request) {
        if (!isUnlocked(request)) {
            return ResponseEntity.status(401).body(Map.of("error", "locked"));
        }
        try {
            // Return bot updates so user can see chat IDs
            JsonNode updates = telegramService.getUpdates();
            List<Map<String, Object>> chats = new ArrayList<>();
            for (JsonNode update : updates) {
                JsonNode msg = update.path("message");
                if (!msg.isMissingNode()) {
                    JsonNode chat = msg.path("chat");
                    chats.add(Map.of(
                            "id", chat.path("id").asLong(),
                            "title", chat.path("title").asText(""),
                            "type", chat.path("type").asText("")
                    ));
                }
            }
            return ResponseEntity.ok(Map.of("chats", chats));
        } catch (Exception e) {
            return ResponseEntity.status(502).body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    public boolean isUnlocked(HttpServletRequest request) {
        // Check cookie
        String session = getCookieValue(request, gateService.cookieName());
        if (session != null && gateService.isValidSession(session)) return true;
        // Check Authorization header
        String auth = request.getHeader("Authorization");
        if (auth != null && auth.toLowerCase().startsWith("bearer ")) {
            String token = auth.substring(7).trim();
            return gateService.isValidSession(token);
        }
        // Check ?t= query param
        String t = request.getParameter("t");
        if (t != null) return gateService.isValidSession(t);
        return false;
    }

    private String getCookieValue(HttpServletRequest request, String name) {
        if (request.getCookies() == null) return null;
        return Arrays.stream(request.getCookies())
                .filter(c -> name.equals(c.getName()))
                .map(Cookie::getValue)
                .findFirst()
                .orElse(null);
    }

    private boolean isSecure(HttpServletRequest request) {
        String proto = request.getHeader("x-forwarded-proto");
        return request.isSecure() || "https".equalsIgnoreCase(proto);
    }
}
