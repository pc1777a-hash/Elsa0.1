# 艾西中文 TTS 候選來源筆記

本筆記只保存外部來源的初步發現；最終聲線選擇仍須在 N1 端以同一段腳本實際試聽比較。

| 供應者 | 初步官方發現 | 來源 |
|---|---|---|
| Google Cloud Text-to-Speech | 官方文件提供語音／類型清單與列出可用語音的 API 範例；官方產品頁宣告超過 380 種聲音，涵蓋 75+ 種語言與變體。 | https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types · https://cloud.google.com/text-to-speech |
| Azure Speech | 官方語言支援表列出 `zh-TW-HsiaoChenNeural` 為台灣中文女性語音，且語音庫支援樣式差異會因聲線而異。 | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support |
| ElevenLabs | 官方中文 TTS 與中文轉寫頁宣告支援中文語音合成與轉寫；實際中文發音、語音資料使用規則與 API 成本需要在選定方案後再核對。 | https://elevenlabs.io/text-to-speech/chinese · https://elevenlabs.io/speech-to-text/chinese |

上述選項皆應由 N1 受控呼叫，手機 App 只送出已授權的文字與播放回傳音檔；不得把供應商金鑰存入 App。

## 已核對的能力

Azure 官方頁面顯示 `zh-TW` 同時列於繁體中文的語音辨識支援範圍，並在同一份頁面提供文字轉語音與 Custom TTS 的能力分類。因此它適合用一個 N1 端供應者同時承接語音輸入與候選固定聲線輸出，但使用前仍需在 Azure 語音庫實聽各個 `zh-TW` 女性聲線。

ElevenLabs 官方中文頁面公開的示範中包含「Anna Su — Casual, Friendly and Bright」等聲線，並說明可選擇適合的中文語音、調整速度、穩定度與風格生成；它也另列出 Voice Cloning 與 TTS API。就影片參考所呈現的柔和、明亮、偏角色化女性感而言，這類可調風格方案最值得優先 A/B 試聽；但不能只依名稱認定與參考影片相同。
