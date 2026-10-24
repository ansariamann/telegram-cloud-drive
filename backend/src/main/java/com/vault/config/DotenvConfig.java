package com.vault.config;

import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.File;

/**
 * Loads .env file from the current directory or parent directory
 * and maps all variables into system properties so System.getProperty(...)
 * and Spring @Value both work regardless of where the app is launched.
 */
@Configuration
public class DotenvConfig {

    @Bean
    public Dotenv dotenv() {
        String dir = "./";
        if (!new File(".env").exists() && new File("../.env").exists()) {
            dir = "../";
        }

        Dotenv dotenv = Dotenv.configure()
                .directory(dir)
                .ignoreIfMissing()
                .load();

        // 1. Expose .env entries as system properties
        dotenv.entries().forEach(e -> {
            if (System.getProperty(e.getKey()) == null) {
                System.setProperty(e.getKey(), e.getValue());
            }
        });

        // 2. Also expose actual OS environment variables as system properties
        System.getenv().forEach((k, v) -> {
            if (System.getProperty(k) == null) {
                System.setProperty(k, v);
            }
        });

        return dotenv;
    }
}
