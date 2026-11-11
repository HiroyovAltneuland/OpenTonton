# Time selection UX

Creation, participant registration and answer editing use `SelectionTimeline`.
The 24-hour axis scrolls as one area, keeping dates aligned and pinned on the left.
Each row has a fixed height; fragmented selections are summarized by their range count.
The summary opens an accessible dialog with exact dates, times and UTC offsets.

- Tap or use Space/Enter to toggle a half-hour slot; drag horizontally to paint a range.
- On touch screens, the band reserves horizontal movement for painting. Use the earlier/later controls or swipe the hour labels to scroll time.
- Eraser clears a date. Undo restores up to 20 preceding selections for that date, including bulk application.
- Participant time-zone changes project existing event-slot keys into display times, preserving the selected instants and passwords.
- Calendar selection removes dates. There is no per-date all-day button.
- Submitting creation/registration confirms the displayed terms. Opening terms preserves form entries.

![Timeline editor](screenshots/timeline-editor.jpg)

## タイムラインの動作確認

ローカル版で「調整ページをつくる」を開き、候補日を1日選ぶ。

1. 時間目盛りを左端まで横スクロールする。左矢印が薄くなり、右矢印で先へ進めることを確認する。
2. 右矢印を押して少し移動する。左右どちらの矢印も使えることを確認する。
3. 右端まで横スクロールする。右矢印が薄くなり、左矢印で戻れることを確認する。
4. Chromeのデバイスモードでスマホ幅に切り替え、時間目盛りを左右にスワイプして同じ状態になることを確認する。

共有ブラウザを使う場合は、ローカルサーバーのアドレスに接続できる環境が必要。接続を拒否された場合は、手元でサーバーとChromeを起動すると同じ手順で確認できる。
