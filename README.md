# AM Premify v4.5

Jalankan: `node server.js` (Node 18+, tanpa npm install), buka http://localhost:8112

Baru di v4.0:
- Layar sambutan: pengguna mengisi nama di awal, sapaan jadi "Halo, (nama)!" (tersimpan di perangkat, bisa diganti lewat chip profil / menu)
- Animasi baru: iris-wipe, typewriter, konfeti, jejak kursor, tilt 3D kartu, parallax hero, ripple tombol, latar melayang
- Fitur: sapaan sesuai waktu + jam live, streak harian, tema warna aksen, toggle efek, tombol Tempel link, validasi email live, progres scroll, tombol ke atas
- Responsif: 320px sampai desktop lebar, safe-area notch, mode landscape

- Popup ajakan ikuti saluran WhatsApp kenzchillz setiap awal masuk (setelah layar sambutan & peringatan), bisa ditutup (tombol X, Esc, atau klik latar)

Baru di v4.1 (tampilan modern & responsif):
- Dock navigasi melayang di HP (Beranda, Premium, Panduan, Menu) menggantikan tab atas, tombol Premium menonjol
- Perintah Cepat: tekan Ctrl/Cmd+K atau "/" (atau tombol "Cari fitur" di desktop, menu di HP) untuk pindah halaman, ganti tema, tempel link, chat admin, dll
- Kartu VIP animasi di hero (desktop), layout melebar di layar besar
- FAQ accordion di halaman Panduan, tombol Bagikan Website (Web Share / salin link)
- Menu bawah bisa di-scroll di layar pendek, fokus keyboard lebih jelas, animasi menghormati "kurangi gerakan"
- Efek gelembung warna-warni: klik/ketuk memunculkan satu gelombang tipis + beberapa gelembung kecil pastel, geser/swipe meninggalkan jejak lembut (ikut toggle Efek Partikel)

Baru di v4.3 (chat, menu admin, blokir perangkat):
- Nama pengguna ikut tampil di feed aktivasi sukses (nama + email tersamar), supaya spam terlihat siapa pelakunya
- Chat di header (ikon pesan): pengguna chat admin, tombol jadi merah + angka saat admin membalas
- Menu admin di /admin (isi ADMIN_PASSWORD di .env): daftar aktivasi, klik nama pengguna -> chat (disiapkan pertanyaan "aktivasi ini untuk apa?"), daftar perangkat
- Admin bisa menonaktifkan fitur premium per perangkat. Dicek di server (bukan hanya tombol): ID perangkat bertanda tangan (cookie HttpOnly + localStorage + IndexedDB), sidik jari perangkat, dan jaringan. Keluar akun / ganti nama / hapus data browser tidak melepas blokir
- Popup konfirmasi profesional menggantikan confirm() bawaan browser (hapus ulasan, hapus riwayat)
- WAJIB: jalankan ulang supabase.sql (bagian v4.3), isi ADMIN_PASSWORD dan APP_SECRET di .env, restart server
- Catatan jujur: tidak ada sistem web yang bisa mengenali perangkat 100%. Pelaku yang berganti HP/browser sekaligus jaringan, atau memakai alat otomatis dengan header palsu, bisa lolos; Turnstile + batas laju membantu menekan itu

v4.4 - Nama "kenz" = developer terverifikasi (centang biru), hanya 1 perangkat:
- Cara memakai: login dulu di /admin (kata sandi admin) pada perangkatmu, lalu isi nama "kenz" di layar sambutan. Perangkat itu jadi developer permanen (tidak perlu login admin lagi)
- Orang lain yang mengetik kenz (K3nz, k e n z, kenz.dev, dll) ditolak server; nama kenz yang tersimpan di perangkat lain otomatis dilepas
- Database menolak ulasan bernama kenz dari identitas selain developer (trigger SQL). Jalankan ulang supabase.sql (bagian v4.4)
- Memindahkan ke HP lain: login /admin di HP baru lalu isi nama kenz, HP lama otomatis kehilangan status developer

v4.5 - Balasan ulasan, like, room publik, kontrol admin per pengguna, perbaikan nama kenz:
- Ulasan: tombol suka (hati) dan "N balasan". Ketuk untuk membuka balasan, bisa membalas, membalas balasan orang lain (@nama), menyukai balasan, dan menghapus balasanmu sendiri. Diperbarui otomatis
- Room publik (/room, ikon Room di dock): semua pengguna ngobrol, ada jumlah online, balas pesan tertentu, hapus pesan sendiri
- Centang biru developer ikut tampil di balasan & room. Ditentukan SERVER dari status perangkat developer, tidak bisa dipalsukan dengan mengganti nama
- Admin > tab Pengguna: tiap pengguna tampil "nama + N× create". Ketuk untuk melihat email apa saja yang dibuatnya (lengkap, bisa disalin), plus tombol Chat / Nonaktifkan premium / Bisukan
- Admin > tab Komunitas: hapus pesan room dan balasan ulasan, bisukan pelaku (durasi menit). Pengguna yang dibisukan tidak bisa kirim pesan di room/balasan
- Email lengkap kini disimpan di tabel privat am_act_owner (hanya server/admin). Aktivasi lama hanya punya email tersamar, jadi tampil bertanda "tersamar (data lama)"
- Nama "kenz": tidak perlu login /admin dulu. Ketik kenz di layar nama, kolom KATA SANDI DEVELOPER muncul, isi sama dengan ADMIN_PASSWORD. Perangkat itu jadi developer permanen (hanya 1 perangkat)
- WAJIB: jalankan ulang supabase.sql (bagian v4.5) lalu restart server

## v4.6
- Perbaikan responsif: topbar tablet/laptop satu baris (public/responsive.css), aman di HP kecil, landscape, dan layar lebar.
- Popup donasi Sociabuzz (muncul setelah popup saluran WhatsApp ditutup; juga bisa dibuka dari Ctrl+K "Dukung developer").

## v4.7
- Popup donasi muncul setiap masuk dan muncul lagi tiap 4 menit setelah ditutup (atur di app.js: donatePop.EVERY).

## v4.8
- Halaman baru **Bypass Link** di `/bypass` (file `public/bypass.html`, `bypass.css`, `bypass.js`), tampilan neo brutalism sama dengan AM Premify. Tempel link shortener, tekan Bypass Sekarang, dapatkan link tujuan. Ada terminal log, tombol Buka/Salin, dan riwayat 10 terakhir (disimpan di browser, bukan di server).
- Server: `GET /api/bypass?url=...` meneruskan ke `https://apiii-xrina.my.id/tools/bypassv2` (batas 20 permintaan / 5 menit per IP, hanya link http/https). Ganti API lewat `BYPASS_UPSTREAM`, atur batas lewat `BYPASS_LIMIT` di `.env`.
- Jika hosting statis (tanpa `server.js`), halaman otomatis memanggil API langsung dari browser. Itu butuh API mengizinkan CORS.
- Akses: tab Bypass di topbar, menu (HP), Ctrl+K "Bypass Link", atau langsung ketik `/bypass` di akhir domain. Prefill: `/bypass?url=https://sfl.gl/q3lfk94`.
