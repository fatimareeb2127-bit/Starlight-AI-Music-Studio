(() => {
  const $ = (id) => document.getElementById(id);
  const piano = $("piano");
  let audioCtx = null, masterGain = null;
  let currentEvents = [], currentMidiUrl = null, currentSongName = "Starlight sketch";
  let recording = false, recordingStart = 0, recordedEvents = [], activeNotes = new Map();
  let playbackTimer = null, playbackStartedAt = 0, playbackOffset = 0, isPlaying = false;
  let toastTimer = null, savedSongs = [];
  const whitePitches = [60,62,64,65,67,69,71,72,74,76,77,79,81,83];
  const blackPitches = [61,63,66,68,70,73,75,78,80,82];
  const keyMap = {'a':60,'w':61,'s':62,'e':63,'d':64,'f':65,'t':66,'g':67,'y':68,'h':69,'u':70,'j':71,'k':72,'o':73,'l':74,'p':75,';':76};
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { toast("Your browser does not support Web Audio."); return false; }
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = Number($("volume").value) / 100 * 0.22;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return true;
  }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function noteOn(pitch, velocity=85, source="piano") {
    if (!ensureAudio()) return;
    const now = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator(), osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    osc1.type = "triangle"; osc1.frequency.value = freq;
    osc2.type = "sine"; osc2.frequency.value = freq * 2.003;
    const amp = Math.max(.01, Math.min(1, velocity / 127)) * .23;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(amp, now + .012);
    osc1.connect(gain); osc2.connect(gain); gain.connect(masterGain);
    gain.gain.exponentialRampToValueAtTime(.0001, now + 1.8);
    osc1.start(now); osc2.start(now);
    osc1.stop(now + 1.85); osc2.stop(now + 1.85);
    activeNotes.set(pitch, {osc1,osc2,gain});
    if (recording && source === "piano") {
      recordedEvents.push({pitch, start:(performance.now()-recordingStart)/1000, duration:.35, velocity});
    }
  }
  function highlight(pitch, on) {
    const key = piano.querySelector(`[data-pitch="${pitch}"]`);
    if (key) key.classList.toggle("active", on);
  }
  function playPitch(pitch, velocity=85) {
    highlight(pitch,true); noteOn(pitch,velocity);
    setTimeout(()=>highlight(pitch,false),250);
  }
  function buildKeyboard() {
    piano.innerHTML = "";
    const first = 48, last = 84;
    const whites = [];
    for (let p=first; p<=last; p++) {
      const pc=p%12;
      if (![1,3,6,8,10].includes(pc)) {
        const key=document.createElement("button"); key.type="button"; key.className="white-key";
        key.dataset.pitch=p; key.setAttribute("aria-label",`Play MIDI note ${p}`);
        key.innerHTML = `<span>${noteName(p)}</span>`;
        key.addEventListener("pointerdown", e=>{e.preventDefault();playPitch(p);});
        piano.appendChild(key); whites.push({pitch:p,element:key});
      }
    }
    const blackOffsets={1:0.68,3:1.68,6:3.68,8:4.68,10:5.68};
    whites.forEach((w,i)=>{
      const pc=(w.pitch+1)%12;
      // place black key after C,D,F,G,A respectively
      const originalPc=w.pitch%12;
      if (![0,2,5,7,9].includes(originalPc) || w.pitch>=last) return;
      const nextPitch=w.pitch+1;
      if (![1,3,6,8,10].includes(nextPitch%12)) return;
      const black=document.createElement("button"); black.type="button";black.className="black-key";black.dataset.pitch=nextPitch;
      const whiteIndex=whites.findIndex(x=>x.pitch===w.pitch);
      const left=((whiteIndex+1)/whites.length)*100;
      black.style.left=`${left}%`;black.setAttribute("aria-label",`Play MIDI note ${nextPitch}`);
      black.innerHTML=`<span>${noteName(nextPitch)}</span>`;
      black.addEventListener("pointerdown",e=>{e.preventDefault();playPitch(nextPitch);});
      piano.appendChild(black);
    });
  }
  function noteName(p){return ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"][p%12]+(Math.floor(p/12)-1);}
  function setEvents(events, name, midiUrl=null) {
    currentEvents=events.slice().sort((a,b)=>a.start-b.start);
    currentSongName=name; currentMidiUrl=midiUrl;
    $("trackTitle").textContent=name;
    $("trackSubtitle").textContent=`${currentEvents.length} note events`;
    $("fileStatus").textContent=currentEvents.length ? `${currentEvents.length} notes ready` : "No song loaded";
    $("downloadBtn").disabled=!midiUrl;
    $("saveSongBtn").disabled=!currentEvents.length;
    $("timeDisplay").textContent="00:00";
    $("trackMeter").style.width="0%";
    toast("Song loaded. Press play to listen.");
  }
  async function generateSong() {
    $("generateBtn").disabled=true; $("heroGenerate").disabled=true;
    $("generatorHint").textContent="Composing a new melody…";
    try {
      const payload = {
        style: $("style").value,
        languageStyle: $("languageStyle").value,
        tempo: Number($("tempo").value),
        bars: Number($("bars").value)
      };
      const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error||"Generation failed.");
      const title = data.style && data.style !== "English" ? data.style : `${data.style || $("style").value} daydream`;
      setEvents(data.events,title,data.midi_url);
      $("trackSubtitle").textContent=`${data.tempo} BPM · ${data.events.length} note events`;
      $("generatorHint").textContent = data.notice || "Your melody is ready. Press play to hear it.";
      if (data.notice) console.info(data.notice);
    } catch(err) { toast(err.message || "Could not generate song."); $("generatorHint").textContent="Please try again."; }
    finally { $("generateBtn").disabled=false; $("heroGenerate").disabled=false; }
  }
  function stopPlayback() {
    if (playbackTimer) clearInterval(playbackTimer);
    playbackTimer=null; isPlaying=false; playbackOffset=0;
    $("playBtn").textContent="▶"; $("trackMeter").style.width="0%"; $("timeDisplay").textContent="00:00";
  }
  function startPlayback() {
    if (!currentEvents.length) { toast("Generate a song or play some piano keys first."); return; }
    if (isPlaying) { playbackOffset += (performance.now()-playbackStartedAt)/1000; if(playbackTimer)clearInterval(playbackTimer);isPlaying=false;$("playBtn").textContent="▶";return; }
    ensureAudio(); isPlaying=true; playbackStartedAt=performance.now(); $("playBtn").textContent="Ⅱ";
    const end = Math.max(...currentEvents.map(e=>e.start+(e.duration||.3)))+.3;
    currentEvents.forEach(e=>{
      const when=(e.start||0)-playbackOffset;
      if(when<0)return;
      setTimeout(()=>{if(isPlaying)playPitch(Number(e.pitch),Number(e.velocity||80));},when*1000);
    });
    playbackTimer=setInterval(()=>{
      if(!isPlaying)return;
      const elapsed=playbackOffset+(performance.now()-playbackStartedAt)/1000;
      $("timeDisplay").textContent=`${String(Math.floor(elapsed/60)).padStart(2,"0")}:${String(Math.floor(elapsed%60)).padStart(2,"0")}`;
      $("trackMeter").style.width=`${Math.min(100,elapsed/end*100)}%`;
      if(elapsed>=end) {stopPlayback();}
    },100);
  }
  function stopAll(){stopPlayback();toast("Playback stopped.");}
  function startRecording() {
    if(recording) {
      recording=false; $("recordBtn").classList.remove("recording");$("recordBtn").innerHTML="<span></span> Record";
      $("pianoStatus").textContent="PIANO READY";
      recordedEvents=recordedEvents.filter(e=>e.duration>0);
      $("playRecordingBtn").disabled=!recordedEvents.length;$("downloadRecordingBtn").disabled=!recordedEvents.length;
      toast(`Recording finished: ${recordedEvents.length} notes.`);
    } else {
      ensureAudio();recordedEvents=[];recording=true;recordingStart=performance.now();
      $("recordBtn").classList.add("recording");$("recordBtn").innerHTML="<span></span> Stop recording";
      $("pianoStatus").textContent="RECORDING IN PROGRESS";toast("Recording started. Play the keys!");
    }
  }
  function playRecording() {
    if(!recordedEvents.length){toast("Record a few notes first.");return;}
    currentEvents=recordedEvents.map(e=>({...e}));currentSongName="My piano recording";currentMidiUrl=null;
    $("trackTitle").textContent=currentSongName;$("trackSubtitle").textContent=`${currentEvents.length} recorded notes`;
    $("saveSongBtn").disabled=false;$("downloadBtn").disabled=true;startPlayback();
  }
  async function exportEvents(events, filename) {
    try {
      const {Midi}=await import("https://cdn.jsdelivr.net/npm/@tonejs/midi@2.0.28/+esm");
      const midi=new Midi();const track=midi.addTrack();
      events.forEach(e=>track.addNote({midi:Number(e.pitch),time:Number(e.start||0),duration:Number(e.duration||.35),velocity:Number(e.velocity||85)/127}));
      const blob=new Blob([midi.toArray()],{type:"audio/midi"});
      const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
    } catch(e) { toast("MIDI export needs an internet connection. Please try again."); }
  }
  function parseLocalMidiFile(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 14) throw new Error("MIDI file is too small.");
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "MThd") throw new Error("This is not a valid MIDI file.");

    const format = (bytes[8] << 8) | bytes[9];
    const trackCount = (bytes[10] << 8) | bytes[11];
    const division = (bytes[12] << 8) | bytes[13];
    if (!trackCount || division === 0) throw new Error("MIDI file structure is invalid.");

    const noteByChannel = new Map();
    const secondsPerTick = (500000 / 1000000) / Math.max(1, division >>> 0);
    let offset = 14;
    let tempo = 500000;

    const readVarLen = (data, pos) => {
      let value = 0;
      let i = pos;
      while (true) {
        const byte = data[i++];
        value = (value << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) return { value, next: i };
      }
    };

    for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
      if (offset + 8 > bytes.length) break;
      const chunkType = String.fromCharCode(...bytes.slice(offset, offset + 4));
      const trackLen = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      offset += 8;
      const trackEnd = offset + trackLen;
      let pos = offset;
      let deltaTime = 0;
      let previousStatus = null;
      let currentTick = 0;

      while (pos < trackEnd) {
        const delta = readVarLen(bytes, pos);
        deltaTime += delta.value;
        pos = delta.next;
        currentTick += deltaTime;
        deltaTime = 0;

        if (pos >= trackEnd) break;
        let status = bytes[pos++];
        if (status < 0x80) {
          if (previousStatus === null) break;
          status = previousStatus;
          pos--;
        } else {
          previousStatus = status;
        }

        if (status === 0xFF) {
          const metaType = bytes[pos++];
          const metaLen = readVarLen(bytes, pos);
          const dataStart = metaLen.next;
          const dataEnd = dataStart + metaLen.value;
          if (metaType === 0x51 && dataEnd <= trackEnd) {
            tempo = (bytes[dataStart] << 16) | (bytes[dataStart + 1] << 8) | bytes[dataStart + 2];
          }
          pos = dataEnd;
          continue;
        }

        if (status === 0xF0 || status === 0xF7) {
          const len = readVarLen(bytes, pos);
          pos = len.next + len.value;
          continue;
        }

        const type = status & 0xF0;
        const channel = status & 0x0F;
        if (pos + 1 >= trackEnd) break;
        const byte1 = bytes[pos++];
        const byte2 = bytes[pos++];

        const tickSeconds = currentTick * secondsPerTick;

        if (type === 0x90 && byte2 > 0) {
          const key = `${channel}:${byte1}`;
          noteByChannel.set(key, { start: tickSeconds, pitch: byte1, velocity: byte2 });
        } else if (type === 0x80 || (type === 0x90 && byte2 === 0)) {
          const key = `${channel}:${byte1}`;
          const active = noteByChannel.get(key);
          if (active) {
            const duration = Math.max(0.08, tickSeconds - active.start);
            const finalEvent = {
              pitch: active.pitch,
              start: active.start,
              duration: duration,
              velocity: active.velocity
            };
            const existing = noteByChannel.get(`done:${channel}:${byte1}`);
            if (!existing || finalEvent.start > existing.start) {
              noteByChannel.set(`done:${channel}:${byte1}`, finalEvent);
            }
            noteByChannel.delete(key);
          }
        }
      }

      offset = trackEnd;
    }

    const finalEvents = [];
    for (const [, value] of noteByChannel.entries()) {
      if (typeof value === "object" && value && "pitch" in value && "start" in value && "duration" in value) {
        finalEvents.push(value);
      }
    }

    const allDone = [];
    for (const [key, value] of noteByChannel.entries()) {
      if (key.startsWith("done:")) allDone.push(value);
    }
    if (allDone.length) {
      allDone.forEach(event => finalEvents.push(event));
    }

    const deduped = [];
    const seen = new Set();
    finalEvents.forEach(event => {
      const sig = `${event.pitch}-${event.start.toFixed(3)}-${event.duration.toFixed(3)}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        deduped.push(event);
      }
    });
    return deduped.sort((a, b) => a.start - b.start);
  }

  async function handleMidiFile(file) {
    if(!file)return;
    stopPlayback();
    const ext=file.name.toLowerCase().split(".").pop();
    if(!["mid","midi"].includes(ext)){toast("Please choose a .mid or .midi file.");return;}
    try {
      const fd=new FormData();
      fd.append("midi", file);
      const uploadResponse = await fetch("/api/upload", { method: "POST", body: fd });
      const uploadData = await uploadResponse.json();

      let events = [];
      let midiDuration = 0;
      if (uploadData && Array.isArray(uploadData.events) && uploadData.events.length) {
        events = uploadData.events;
        midiDuration = Math.max(...events.map(e => (Number(e.start) || 0) + (Number(e.duration) || 0.2)));
      } else {
        try {
          const localMidi = parseLocalMidiFile(await file.arrayBuffer());
          events = localMidi;
          midiDuration = events.length ? Math.max(...events.map(e => e.start + (e.duration || 0.2))) : 0;
        } catch (localError) {
          try {
            const {Midi}=await import("https://cdn.jsdelivr.net/npm/@tonejs/midi@2.0.28/+esm");
            const midi=new Midi(await file.arrayBuffer());
            events=[];
            midi.tracks.forEach(track=>track.notes.forEach(n=>events.push({pitch:n.midi,start:n.time,duration:n.duration,velocity:Math.round(n.velocity*127)})));
            midiDuration = midi.duration || 0;
          } catch (remoteError) {
            toast("Could not read MIDI. The file may be invalid or the browser cannot access the MIDI parser.");
            return;
          }
        }
      }

      if(!events.length){toast("No playable notes found in this MIDI file.");return;}
      setEvents(events,file.name.replace(/\.(mid|midi)$/i,""),null);
      $("trackSubtitle").textContent=`${Math.max(1, midiDuration).toFixed(1)} sec · imported MIDI`;
      $("fileStatus").textContent=file.name;
      $("downloadBtn").disabled=false;
      $("downloadBtn").onclick=()=>exportEvents(currentEvents,`${currentSongName}.mid`);
      if ($("midiFile")) $("midiFile").value = "";
      toast("MIDI file loaded. Press play to listen.");
    } catch(e){toast("Could not read MIDI. Check the file and try again.");}
  }
  function saveCurrent() {
    if(!currentEvents.length)return;
    const item={name:currentSongName,events:currentEvents.map(e=>({...e})),savedAt:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})};
    savedSongs.unshift(item);renderLibrary();toast("Saved to your music library.");
  }
  function renderLibrary() {
    $("libraryEmpty").style.display=savedSongs.length?"none":"flex";
    $("savedList").innerHTML="";
    savedSongs.forEach((song,i)=>{
      const row=document.createElement("div");row.className="saved-item";
      row.innerHTML=`<span>♫</span><div><b></b><small>${song.events.length} notes · ${song.savedAt}</small></div><button aria-label="Play saved song">▶</button>`;
      row.querySelector("b").textContent=song.name;
      row.querySelector("button").addEventListener("click",()=>{setEvents(song.events,song.name);startPlayback();});
      $("savedList").appendChild(row);
    });
  }
  // Floating starfield canvas
  const canvas=$("sky"),ctx=canvas.getContext("2d");let stars=[];
  function resizeSky(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;canvas.style.width=innerWidth+"px";canvas.style.height=innerHeight+"px";ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);stars=Array.from({length:Math.min(125,Math.floor(innerWidth/8))},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:Math.random()*1.7+.25,a:Math.random()*.7+.15,s:Math.random()*.25+.05,phase:Math.random()*6.28}));}
  function drawSky(t){ctx.clearRect(0,0,innerWidth,innerHeight);stars.forEach(s=>{const alpha=s.a*(.6+.4*Math.sin(t*.001*s.s+s.phase));ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(198,205,255,${alpha})`;ctx.fill();if(s.r>1.45){ctx.fillRect(s.x-3,s.y-.4,6,.8);ctx.fillRect(s.x-.4,s.y-3,.8,6)}});requestAnimationFrame(drawSky);}
  $("tempo").addEventListener("input",()=>{$("tempoValue").textContent=$("tempo").value;});
  $("generateBtn").addEventListener("click",generateSong);$("heroGenerate").addEventListener("click",()=>{document.querySelector("#studio").scrollIntoView({behavior:"smooth"});generateSong();});
  $("bannerPlay").addEventListener("click",()=>{document.querySelector("#piano-section").scrollIntoView({behavior:"smooth"});});
  $("playBtn").addEventListener("click",startPlayback);$("stopBtn").addEventListener("click",stopAll);
  $("recordBtn").addEventListener("click",startRecording);$("clearRecordingBtn").addEventListener("click",()=>{recordedEvents=[];$("playRecordingBtn").disabled=true;$("downloadRecordingBtn").disabled=true;toast("Recording cleared.");});
  $("playRecordingBtn").addEventListener("click",playRecording);
  $("downloadRecordingBtn").addEventListener("click",()=>exportEvents(recordedEvents,"my-piano-recording.mid"));
  $("saveSongBtn").addEventListener("click",saveCurrent);
  $("downloadBtn").addEventListener("click",()=>{if(currentMidiUrl){const a=document.createElement("a");a.href=currentMidiUrl;a.download="starlight-song.mid";a.click();}else exportEvents(currentEvents,`${currentSongName}.mid`);});
  $("midiFile").addEventListener("change",e=>handleMidiFile(e.target.files[0]));
  const dz=$("dropZone");["dragenter","dragover"].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();dz.style.borderColor="#b8a2ff";}));["dragleave","drop"].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();dz.style.borderColor="";}));dz.addEventListener("drop",e=>handleMidiFile(e.dataTransfer.files[0]));
  $("volume").addEventListener("input",()=>{if(masterGain)masterGain.gain.value=Number($("volume").value)/100*.22;});
  document.addEventListener("keydown",e=>{if(e.repeat||e.target.matches("input,select,textarea"))return;const p=keyMap[e.key.toLowerCase()];if(p!==undefined){e.preventDefault();playPitch(p);}});
  $("soundToggle").addEventListener("click",()=>{ensureAudio();playPitch(84);});
  buildKeyboard();resizeSky();requestAnimationFrame(drawSky);
})();
