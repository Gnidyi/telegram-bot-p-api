require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const TELEGRAM_TOKEN = "7863410300:AAHP7_JQtVwghqgQwc8YDl4g64lNX4juZzg";
const PERSPECTIVE_API_KEY = "AIzaSyCcvILtOkLlrx6lnhcS83NO2BGhzf5WzNM";

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const warnings = {};

async function checkToxicity(message) {
    const url = `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${PERSPECTIVE_API_KEY}`;

    const requestData = {
        comment: { text: message },
        languages: ["ru", "en"],
        requestedAttributes: { TOXICITY: {} }
    };

    try {
        const response = await axios.post(url, requestData);
        return response.data.attributeScores.TOXICITY.summaryScore.value;
    } catch (error) {
        console.error("❌ Помилка при запиті до Perspective API:", error);
        return null;
    }
}

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const userId = msg.from.id;
    const text = msg.text;
    const user = msg.from;

    const toxicityScore = await checkToxicity(text);

    if (toxicityScore !== null) {
        console.log(`👀 Перевірено повідомлення від ${user.username || user.first_name}: "${text}" (Toxicity: ${toxicityScore.toFixed(2)})`);

        if (!warnings[chatId]) {
            warnings[chatId] = {};
        }

        if (!warnings[chatId][user.id]) {
            warnings[chatId][user.id] = { count: 0 };
        }

        const userWarnings = warnings[chatId][user.id];

        if (toxicityScore >= 0.5 && toxicityScore < 0.6) {
            // Повідомлення з токсичністю 50-60% — відправляємо з кнопкою для перегляду
            const button = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "View Message", callback_data: `view_${messageId}_${text}` }]
                    ]
                }
            };

            // Відправляємо повідомлення з кнопкою для перегляду
            await bot.sendMessage(chatId, `⚠️ Попередження: це повідомлення може містити образливий контент. Натисніть "View Message" для перегляду.`, button);

            await bot.deleteMessage(chatId, messageId);
        }

        if (toxicityScore >= 0.60 && toxicityScore < 0.85) {
            // 60-85% — видалити повідомлення та додати попередження
            try {
                await bot.deleteMessage(chatId, messageId);
                userWarnings.count += 1;
                await bot.sendMessage(chatId, `⚠️ [${user.first_name}](tg://user?id=${user.id}), ваше повідомлення було видалено через токсичність (${(toxicityScore * 100).toFixed(1)}%). Попереджень: ${userWarnings.count}/3`, { parse_mode: "Markdown" });
                console.log(`❌ Видалено повідомлення: "${text}"`);
                
                if (userWarnings.count >= 3) {
                    try {
                        
                        await bot.sendMessage(chatId, `🔇 [${user.first_name}](tg://user?id=${user.id}) тимчасово позбавлений можливості писати повідомлення на 2 хвилини через 3 попередження.`, { parse_mode: "Markdown" });

                        await bot.sendMessage(user.id, `🔇 Ви втратили можливість писати у чаті ${msg.chat.title} на 2 хвилини через 3 попередження про токсичність. Дотримуйтесь правил чату!`, { parse_mode: "Markdown" });

                        await bot.restrictChatMember(chatId, userId, {
                            permissions: {
                                can_send_messages: false,
                                can_send_media_messages: false,
                                can_send_polls: false,
                                can_send_other_messages: false,
                                can_add_web_page_previews: false,
                                can_change_info: false,
                                can_invite_users: false,
                                can_pin_messages: false
                            },
                            until_date: Math.floor(Date.now() / 1000) + 120 // 2 хвилини
                        });

                    } catch (error) {
                        console.error("❌ Помилка при обмеженні прав користувача:", error);
                    }
                }
            } catch (error) {
                console.error("❌ Помилка видалення повідомлення:", error);
            }
        }

        if (toxicityScore >= 0.85) {
            // Повідомлення з токсичністю 85% і вище — блокування користувача
            try {
                
                await bot.deleteMessage(chatId, messageId);
                // Сповіщення у загальному чаті
                await bot.sendMessage(chatId, `🚫 [${user.first_name}](tg://user?id=${user.id}), ви були заблоковані на 2 хвилини за токсичне повідомлення (${(toxicityScore * 100).toFixed(1)}%)!`, { parse_mode: "Markdown" });
        
                // Особисте повідомлення користувачу
                await bot.sendMessage(user.id, `🚫 Ви були заблоковані на 2 хвилини у чаті ${msg.chat.title} за токсичне повідомлення (${(toxicityScore * 100).toFixed(1)}%). Дотримуйтесь правил спілкування!`, { parse_mode: "Markdown" });

                await bot.banChatMember(chatId, user.id, { until_date: Math.floor(Date.now() / 1000) + 120 });
        
                console.log(`❌ Користувач ${user.first_name} був заблокований за токсичність: "${text}"`);
            } catch (error) {
                console.error("❌ Помилка при блокуванні користувача:", error);
            }
        }
    }
});

// Обробка натискання кнопки для перегляду токсичного повідомлення
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const user = callbackQuery.from;
    const [_, originalMessageId, originalText] = callbackQuery.data.split("_");

    if (callbackQuery.data.startsWith("view_")) {
        try {
            // Відправляємо токсичне повідомлення в особисті повідомлення користувача
            await bot.sendMessage(user.id, `🔓 Токсичне повідомлення: "${originalText}"`, {
                parse_mode: "Markdown",
            });

            // Видаляємо повідомлення з чату після натискання
            await bot.deleteMessage(chatId, messageId);
            console.log(`❌ Повідомлення видалено після перегляду: "${originalText}"`);

            // Відповідаємо користувачу, що повідомлення було переглянуте
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: "Токсичне повідомлення було розблоковано для перегляду.",
                show_alert: true
            });
        } catch (error) {
            console.error("❌ Помилка при перегляді повідомлення:", error);
        }
    }
});
