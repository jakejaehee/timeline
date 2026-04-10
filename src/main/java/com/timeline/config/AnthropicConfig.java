package com.timeline.config;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Anthropic 클라이언트 Bean 설정
 * - API Key가 유효하게 설정되어 있을 때만 Bean 생성
 * - API Key가 없거나 placeholder이면 Bean을 생성하지 않음 (앱 시작은 정상 진행)
 */
@Slf4j
@Configuration
public class AnthropicConfig {

    @Bean
    @ConditionalOnProperty(name = "anthropic.api-key")
    public AnthropicClient anthropicClient(AnthropicProperties anthropicProperties) {
        if (!anthropicProperties.isConfigured()) {
            log.warn("Anthropic API Key가 placeholder입니다. AI 파싱 기능이 비활성화됩니다.");
            return null;
        }

        log.info("Anthropic 클라이언트 초기화 - model: {}, maxTokens: {}",
                anthropicProperties.getModel(), anthropicProperties.getMaxTokens());

        return AnthropicOkHttpClient.builder()
                .apiKey(anthropicProperties.getApiKey())
                .build();
    }
}
