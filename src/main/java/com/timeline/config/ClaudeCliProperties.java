package com.timeline.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Claude CLI 설정 프로퍼티
 */
@Data
@ConfigurationProperties(prefix = "claude-cli")
public class ClaudeCliProperties {

    /**
     * Claude CLI 실행 경로 (기본: "claude")
     */
    private String executable = "claude";

    /**
     * 사용할 모델명 (기본: "sonnet")
     */
    private String model = "sonnet";

    /**
     * CLI 실행 타임아웃 (초, 기본: 120)
     */
    private int timeoutSeconds = 120;
}
