import type { BridgeConnection, BridgeTtsResponse } from "@surf-ai/shared";
import { buildBridgeHeaders } from "../utils/sidepanel-helpers";

interface UseSidepanelTtsOptions {
  activeConnection: BridgeConnection | undefined;
  ttsReady: boolean;
}

interface UseSidepanelTtsResult {
  requestTts: (text: string) => Promise<void>;
}

export function useSidepanelTts({
  activeConnection,
  ttsReady
}: UseSidepanelTtsOptions): UseSidepanelTtsResult {
  async function requestTts(text: string): Promise<void> {
    if (!activeConnection || !ttsReady) return;

    try {
      const response = await fetch(`${activeConnection.baseUrl}/tts`, {
        method: "POST",
        headers: buildBridgeHeaders(activeConnection, true),
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as BridgeTtsResponse;
      const playbackUrl =
        payload.audioUrl ??
        (payload.base64Audio
          ? `data:${payload.mimeType ?? "audio/mpeg"};base64,${payload.base64Audio}`
          : undefined);

      if (!playbackUrl) {
        return;
      }

      const audio = new Audio(playbackUrl);
      void audio.play();
    } catch {
      // Chat flow should continue even if TTS is unavailable.
    }
  }

  return { requestTts };
}
