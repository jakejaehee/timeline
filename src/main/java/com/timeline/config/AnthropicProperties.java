package com.timeline.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Anthropic API 설정 프로퍼티
 */
@Data
@ConfigurationProperties(prefix = "anthropic")
public class AnthropicProperties {

    /**
     * Anthropic API Key
     */
    private String apiKey;

    /**
     * 사용할 모델명 (예: claude-sonnet-4-5)
     */
    private String model = "claude-sonnet-4-5";

    /**
     * 최대 토큰 수
     */
    private long maxTokens = 4096;

    /**
     * API Key가 설정되어 있는지 확인
     */
    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank() && !apiKey.equals("sk-ant-placeholder");
    }
}
