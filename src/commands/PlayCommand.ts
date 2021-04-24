/* eslint-disable block-scoped-var, @typescript-eslint/restrict-template-expressions */
import { BaseCommand } from "../structures/BaseCommand";
import { ServerQueue } from "../structures/ServerQueue";
import { Util, MessageEmbed, VoiceChannel } from "discord.js";
import { decodeHTML } from "entities";
import { IMessage, ISong, IGuild, ITextChannel } from "../../typings";
import { DefineCommand } from "../utils/decorators/DefineCommand";
import { isUserInTheVoiceChannel, isSameVoiceChannel, isValidVoiceChannel } from "../utils/decorators/MusicHelper";
import { createEmbed } from "../utils/createEmbed";
import { Video } from "../utils/YouTube/structures/Video";
let disconnectTimer: any;

@DefineCommand({
    aliases: ["p", "add", "play-music"],
    name: "play",
    description: "Play some music",
    usage: "{prefix}play <youtube video or playlist link | youtube video name>"
})
export class PlayCommand extends BaseCommand {
    @isUserInTheVoiceChannel()
    @isValidVoiceChannel()
    @isSameVoiceChannel()
    public async execute(message: IMessage, args: string[]): Promise<any> {
        const voiceChannel = message.member!.voice.channel!;
        if (!args[0]) {
            return message.channel.send(
                createEmbed("error", `Niepoprawne użycie, spróbuj **\`${this.client.config.prefix}help play\`** po więcej informacji`)
            );
        }
        const searchString = args.join(" ");
        const url = searchString.replace(/<(.+)>/g, "$1");

        if (message.guild?.queue !== null && voiceChannel.id !== message.guild?.queue.voiceChannel?.id) {
            return message.channel.send(
                createEmbed("warn", `Ten bot muzyczny już gra dla **${message.guild?.queue.voiceChannel?.name}** kanału głosowego`)
            );
        }

        if (/^https?:\/\/(www\.youtube\.com|youtube.com)\/playlist(.*)$/.exec(url)) {
            try {
                const id = new URL(url).searchParams.get("list")!;
                const playlist = await this.client.youtube.getPlaylist(id);
                const videos = await playlist.getVideos();
                let skippedVideos = 0;
                const addingPlaylistVideoMessage = await message.channel.send(
                    createEmbed("info", `Dodawanie wszystkich piosenek do **[${playlist.title}](${playlist.url})** playlisty, proszę czekać...`)
                        .setThumbnail(playlist.thumbnailURL)
                );
                for (const video of Object.values(videos)) {
                    if (video.isPrivate) {
                        skippedVideos++;
                        continue;
                    } else {
                        const video2 = await this.client.youtube.getVideo(video.id);
                        await this.handleVideo(video2, message, voiceChannel, true);
                    }
                }
                if (skippedVideos !== 0) {
                    message.channel.send(
                        createEmbed("warn", `${skippedVideos} ${skippedVideos >= 2 ? `videos` : `video`} zostały pominięte , ponieważ są tą prywatne filmy`)
                    ).catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                }
                message.channel.messages.fetch(addingPlaylistVideoMessage.id, false).then(m => m.delete()).catch(e => this.client.logger.error("YT_PLAYLIST_ERR:", e));
                if (skippedVideos === playlist.itemCount) {
                    return message.channel.send(
                        createEmbed("error", `Nie udało się załadować playlisty **[${playlist.title}](${playlist.url})**, ponieważ wszystkie z tych elementów to prywatne filmy`)
                            .setThumbnail(playlist.thumbnailURL)
                    );
                }
                return message.channel.send(
                    createEmbed("info", `✅ **|** Wszystkie piosenki w **[${playlist.title}](${playlist.url})** playliście zostały dodane do kolejki`)
                        .setThumbnail(playlist.thumbnailURL)

                );
            } catch (e) {
                this.client.logger.error("YT_PLAYLIST_ERR:", new Error(e.stack));
                return message.channel.send(createEmbed("error", `Nie udało mi się załadować playlisty \nBłąd: **\`${e.message}\`**`));
            }
        }
        try {
            const id = new URL(url).searchParams.get("v")!;
            // eslint-disable-next-line no-var, block-scoped-var
            var video = await this.client.youtube.getVideo(id);
        } catch (e) {
            try {
                const videos = await this.client.youtube.searchVideos(searchString, this.client.config.searchMaxResults);
                if (videos.length === 0) return message.channel.send(createEmbed("error", "Nie udało mi się uzyskać żadnych wyników wyszukiwania, spróbuj ponownie"));
                if (this.client.config.disableSongSelection) { video = await this.client.youtube.getVideo(videos[0].id); } else {
                    let index = 0;
                    const msg = await message.channel.send(new MessageEmbed()
                        .setColor(this.client.config.embedColor)
                        .setAuthor("Music Selection", message.client.user?.displayAvatarURL() as string)
                        .setDescription(`\`\`\`${videos.map(video => `${++index} - ${this.cleanTitle(video.title)}`).join("\n")}\`\`\`` +
                        "\nWybierz jeden z wyników od **\`1-10\`**")
                        .setFooter("• Wpisz cancel lub c, aby anulować wybór muzyki"));
                    try {
                    // eslint-disable-next-line no-var
                        var response = await message.channel.awaitMessages((msg2: IMessage) => {
                            if (message.author.id !== msg2.author.id) return false;

                            if (msg2.content === "cancel" || msg2.content === "c") return true;
                            return Number(msg2.content) > 0 && Number(msg2.content) < 13;
                        }, {
                            max: 1,
                            time: this.client.config.selectTimeout,
                            errors: ["time"]
                        });
                        msg.delete().catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                        response.first()?.delete({ timeout: 3000 }).catch(e => e);
                    } catch (error) {
                        msg.delete().catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                        return message.channel.send(createEmbed("error", "Brak lub nieprawidłowa wartość, wybór muzyki został anulowany"));
                    }
                    if (response.first()?.content === "c" || response.first()?.content === "cancel") {
                        return message.channel.send(createEmbed("warn", "Wybór muzyki został anulowany"));
                    }
                    const videoIndex = parseInt(response.first()?.content as string);
                    video = await this.client.youtube.getVideo(videos[videoIndex - 1].id);
                }
            } catch (err) {
                this.client.logger.error("YT_SEARCH_ERR:", err);
                return message.channel.send(createEmbed("error", `Nie udało mi się uzyskać żadnych wyników wyszukiwania\nBłąd: **\`${err.message}\`**`));
            }
        }
        return this.handleVideo(video, message, voiceChannel);
    }

    private async handleVideo(video: Video, message: IMessage, voiceChannel: VoiceChannel, playlist = false): Promise<any> {
        const song: ISong = {
            duration: this.milDuration(video.duration),
            id: video.id,
            thumbnail: video.thumbnailURL,
            title: this.cleanTitle(video.title),
            url: video.url
        };
        if (message.guild?.queue) {
            if (!this.client.config.allowDuplicate && message.guild.queue.songs.find(s => s.id === song.id)) {
                return message.channel.send(
                    createEmbed("warn", `🎶 **|** **[${song.title}](${song.url})** jest już w kolejce, ` +
                `użyj zamiast tego komendy **\`${this.client.config.prefix}repeat\`**`)
                        .setTitle("Już w kolejce")
                );
            }
            message.guild.queue.songs.addSong(song);
            if (!playlist) {
                message.channel.send(createEmbed("info", `✅ **|** **[${song.title}](${song.url})** zostało dodane do kolejki`).setThumbnail(song.thumbnail))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
            }
        } else {
            message.guild!.queue = new ServerQueue(message.channel as ITextChannel, voiceChannel);
            message.guild?.queue.songs.addSong(song);
            if (!playlist) {
                message.channel.send(createEmbed("info", `✅ **|** **[${song.title}](${song.url})** zostało dodane do kolejki`).setThumbnail(song.thumbnail))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
            }
            try {
                const connection = await message.guild!.queue.voiceChannel!.join();
                message.guild!.queue.connection = connection;
            } catch (error) {
                message.guild?.queue.songs.clear();
                message.guild!.queue = null;
                this.client.logger.error("PLAY_CMD_ERR:", error);
                message.channel.send(createEmbed("error", `Wystąpił błąd podczas dołączania do kanału głosowego, powód: **\`${error.message}\`**`))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                return undefined;
            }
            this.play(message.guild!).catch(err => {
                message.channel.send(createEmbed("error", `Wystąpił błąd podczas próby odtworzenia muzyki, powód: **\`${err.message}\`**`))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                return this.client.logger.error("PLAY_CMD_ERR:", err);
            });
        }
        return message;
    }

    private async play(guild: IGuild): Promise<any> {
        const serverQueue = guild.queue!;
        const song = serverQueue.songs.first();
        const timeout = this.client.config.deleteQueueTimeout;
        clearTimeout(disconnectTimer);
        if (!song) {
            if (serverQueue.lastMusicMessageID !== null) serverQueue.textChannel?.messages.fetch(serverQueue.lastMusicMessageID, false).then(m => m.delete()).catch(e => this.client.logger.error("PLAY_ERR:", e));
            if (serverQueue.lastVoiceStateUpdateMessageID !== null) serverQueue.textChannel?.messages.fetch(serverQueue.lastVoiceStateUpdateMessageID, false).then(m => m.delete()).catch(e => this.client.logger.error("PLAY_ERR:", e));
            serverQueue.textChannel?.send(
                createEmbed("info", `⏹ **|** Muzyka się skończyła, użyj **\`${guild.client.config.prefix}play\`**, aby puścić piosenkę`)
            ).catch(e => this.client.logger.error("PLAY_ERR:", e));
            disconnectTimer = setTimeout(() => {
                serverQueue.connection?.disconnect();
                serverQueue.textChannel?.send(
                    createEmbed("info", `👋 **|** Opuściłem kanał głosowy, ponieważ byłem nieaktywny zbyt długo.`)
                ).then(m => m.delete({ timeout: 5000 })).catch(e => e);
            }, timeout);
            return guild.queue = null;
        }

        serverQueue.connection?.voice?.setSelfDeaf(true).catch(e => this.client.logger.error("PLAY_ERR:", e));
        const songData = await this.client.youtube.downloadVideo(song.url, {
            cache: this.client.config.cacheYoutubeDownloads,
            cacheMaxLength: this.client.config.cacheMaxLengthAllowed,
            skipFFmpeg: true
        });

        if (songData.cache) this.client.logger.info(`${this.client.shard ? `[Fragment #${this.client.shard.ids}]` : ""} Korzystanie z pamięci podręcznej muzyki "${song.title}" na ${guild.name}`);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        songData.on("error", err => { err.message = `YTDLError: ${err.message}`; serverQueue.connection?.dispatcher?.emit("error", err); });

        serverQueue.connection?.play(songData, { type: songData.info.canSkipFFmpeg ? "webm/opus" : "unknown", bitrate: "auto", highWaterMark: 1 })
            .on("start", () => {
                serverQueue.playing = true;
                this.client.logger.info(`${this.client.shard ? `[Shard #${this.client.shard.ids}]` : ""} Music: "${song.title}" on ${guild.name} has started`);
                if (serverQueue.lastMusicMessageID !== null) serverQueue.textChannel?.messages.fetch(serverQueue.lastMusicMessageID, false).then(m => m.delete()).catch(e => this.client.logger.error("PLAY_ERR:", e));
                serverQueue.textChannel?.send(createEmbed("info", `▶ **|** Started playing: **[${song.title}](${song.url})**`).setThumbnail(song.thumbnail))
                    .then(m => serverQueue.lastMusicMessageID = m.id)
                    .catch(e => this.client.logger.error("PLAY_ERR:", e));
            })
            .on("finish", () => {
                this.client.logger.info(`${this.client.shard ? `[Shard #${this.client.shard.ids}]` : ""} Music: "${song.title}" on ${guild.name} has ended`);
                // eslint-disable-next-line max-statements-per-line
                if (serverQueue.loopMode === 0) { serverQueue.songs.deleteFirst(); } else if (serverQueue.loopMode === 2) { serverQueue.songs.deleteFirst(); serverQueue.songs.addSong(song); }
                if (serverQueue.lastMusicMessageID !== null) serverQueue.textChannel?.messages.fetch(serverQueue.lastMusicMessageID, false).then(m => m.delete()).catch(e => this.client.logger.error("PLAY_ERR:", e));
                serverQueue.textChannel?.send(createEmbed("info", `⏹ **|** Przestałem grać **[${song.title}](${song.url})**`).setThumbnail(song.thumbnail))
                    .then(m => serverQueue.lastMusicMessageID = m.id)
                    .catch(e => this.client.logger.error("PLAY_ERR:", e))
                    .finally(() => {
                        this.play(guild).catch(e => {
                            serverQueue.textChannel?.send(createEmbed("error", `Wystąpił błąd podczas próby odtworzenia muzyki, powód: **\`${e}\`**`))
                                .catch(e => this.client.logger.error("PLAY_ERR:", e));
                            serverQueue.connection?.dispatcher.end();
                            return this.client.logger.error("PLAY_ERR:", e);
                        });
                    });
            })
            .on("error", (err: Error) => {
                serverQueue.textChannel?.send(createEmbed("error", `Wystąpił błąd podczas odtwarzania muzyki, powód: **\`${err.message}\`**`))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                guild.queue?.voiceChannel?.leave();
                guild.queue = null;
                this.client.logger.error("PLAY_ERR:", err);
            })
            .setVolume(serverQueue.volume / guild.client.config.maxVolume);
    }

    private milDuration(duration: any): number {
        const days = duration.days * 86400000;
        const hours = duration.hours * 3600000;
        const minutes = duration.minutes * 60000;
        const seconds = duration.seconds * 1000;

        return days + hours + minutes + seconds;
    }

    private cleanTitle(title: string): string {
        return Util.escapeMarkdown(decodeHTML(title));
    }
}
