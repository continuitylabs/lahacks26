import AVFoundation
import Foundation
import React
import ZeticMLange

@objc(ZeticLlm)
class ZeticLlm: RCTEventEmitter {
  private struct YamnetEvidence {
    let screamLabel: String
    let screamScore: Float
    let screamAggregateScore: Float
    let screamTop3Hit: Bool
    let whistleScore: Float
    let hornScore: Float
    let rms: Float
  }

  private let stateLock = NSLock()

  private var model: ZeticMLangeLLMModel?
  private var generationTask: Task<Void, Never>?
  private var cancelRequested = false

  private var yamnetModel: ZeticMLangeModel?
  private var audioEngine: AVAudioEngine?
  private var audioConverter: AVAudioConverter?
  private let yamnetQueue = DispatchQueue(label: "com.northstar.yamnet")
  private let yamnetTargetFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32,
    sampleRate: 16_000,
    channels: 1,
    interleaved: false
  )!
  private var yamnetSampleWindow: [Float] = []
  private var yamnetMonitoring = false
  private var yamnetInferenceInFlight = false
  private var yamnetLastInferenceAt: TimeInterval = 0
  private var yamnetLastTriggerAt: TimeInterval = 0
  private var yamnetScoreThreshold: Float = 0.2
  private var yamnetAmplitudeThreshold: Float = 0.012

  private var hasListeners = false

  private let yamnetWindowSize = 16_000
  private let yamnetWindowStrideSeconds: TimeInterval = 0.6
  private let yamnetTriggerCooldownSeconds: TimeInterval = 5
  private let yamnetFallbackKey = "dev_4870cfa9449c4db6953dca3214c06ae8"
  private let yamnetFallbackName = "google/Sound Classification(YAMNET)"
  private let yamnetFallbackVersion = 1
  private let yamnetClassCount = 521

  private let screamIndices = [6, 7, 8, 9, 10, 11, 19, 21, 22, 33, 34, 39]
  private let whistleIndex = 35
  private let suppressedYamnetIndices: Set<Int> = [
    24, // Singing
    25, // Choir
    26, // Yodeling
    27, // Chant
    28, // Mantra
    29, // Child singing
    30, // Synthetic singing
    31, // Rapping
    32, // Humming
    132, // Music
    133, // Musical instrument
    147, // Keyboard (musical)
    148, // Piano
    153, // Synthesizer
    156, // Percussion
    157, // Drum kit
    179, // Orchestra
    203, // Harmonica
    211, // Pop music
    212, // Hip hop music
    214, // Rock music
    221, // Rhythm and blues
    223, // Reggae
    230, // Jazz
    232, // Classical music
    234, // Electronic music
    239, // Electronica
    240, // Electronic dance music
    241, // Ambient music
    249, // Vocal music
    250, // A capella
    261, // Song
    262, // Background music
    263, // Theme music
    264, // Jingle (music)
    265, // Soundtrack music
    267, // Video game music
    268, // Christmas music
    269, // Dance music
    270, // Wedding music
    271, // Happy music
    272, // Sad music
    273, // Tender music
    274, // Exciting music
    275, // Angry music
    276, // Scary music
    294, // Vehicle
    300, // Motor vehicle (road)
    301, // Car
    302, // Vehicle horn, car horn, honking
    303, // Toot
    310, // Truck
    312, // Air horn, truck horn
    321, // Traffic noise, roadway noise
  ]
  private let vehicleHornIndex = 302
  private let airHornIndex = 312
  private let yamnetLabels: [String] = [
    "Speech",
    "Child speech, kid speaking",
    "Conversation",
    "Narration, monologue",
    "Babbling",
    "Speech synthesizer",
    "Shout",
    "Bellow",
    "Whoop",
    "Yell",
    "Children shouting",
    "Screaming",
    "Whispering",
    "Laughter",
    "Baby laughter",
    "Giggle",
    "Snicker",
    "Belly laugh",
    "Chuckle, chortle",
    "Crying, sobbing",
    "Baby cry, infant cry",
    "Whimper",
    "Wail, moan",
    "Sigh",
    "Singing",
    "Choir",
    "Yodeling",
    "Chant",
    "Mantra",
    "Child singing",
    "Synthetic singing",
    "Rapping",
    "Humming",
    "Groan",
    "Grunt",
    "Whistling",
    "Breathing",
    "Wheeze",
    "Snoring",
    "Gasp",
    "Pant",
    "Snort",
    "Cough",
    "Throat clearing",
    "Sneeze",
    "Sniff",
    "Run",
    "Shuffle",
    "Walk, footsteps",
    "Chewing, mastication",
    "Biting",
    "Gargling",
    "Stomach rumble",
    "Burping, eructation",
    "Hiccup",
    "Fart",
    "Hands",
    "Finger snapping",
    "Clapping",
    "Heart sounds, heartbeat",
    "Heart murmur",
    "Cheering",
    "Applause",
    "Chatter",
    "Crowd",
    "Hubbub, speech noise, speech babble",
    "Children playing",
    "Animal",
    "Domestic animals, pets",
    "Dog",
    "Bark",
    "Yip",
    "Howl",
    "Bow-wow",
    "Growling",
    "Whimper (dog)",
    "Cat",
    "Purr",
    "Meow",
    "Hiss",
    "Caterwaul",
    "Livestock, farm animals, working animals",
    "Horse",
    "Clip-clop",
    "Neigh, whinny",
    "Cattle, bovinae",
    "Moo",
    "Cowbell",
    "Pig",
    "Oink",
    "Goat",
    "Bleat",
    "Sheep",
    "Fowl",
    "Chicken, rooster",
    "Cluck",
    "Crowing, cock-a-doodle-doo",
    "Turkey",
    "Gobble",
    "Duck",
    "Quack",
    "Goose",
    "Honk",
    "Wild animals",
    "Roaring cats (lions, tigers)",
    "Roar",
    "Bird",
    "Bird vocalization, bird call, bird song",
    "Chirp, tweet",
    "Squawk",
    "Pigeon, dove",
    "Coo",
    "Crow",
    "Caw",
    "Owl",
    "Hoot",
    "Bird flight, flapping wings",
    "Canidae, dogs, wolves",
    "Rodents, rats, mice",
    "Mouse",
    "Patter",
    "Insect",
    "Cricket",
    "Mosquito",
    "Fly, housefly",
    "Buzz",
    "Bee, wasp, etc.",
    "Frog",
    "Croak",
    "Snake",
    "Rattle",
    "Whale vocalization",
    "Music",
    "Musical instrument",
    "Plucked string instrument",
    "Guitar",
    "Electric guitar",
    "Bass guitar",
    "Acoustic guitar",
    "Steel guitar, slide guitar",
    "Tapping (guitar technique)",
    "Strum",
    "Banjo",
    "Sitar",
    "Mandolin",
    "Zither",
    "Ukulele",
    "Keyboard (musical)",
    "Piano",
    "Electric piano",
    "Organ",
    "Electronic organ",
    "Hammond organ",
    "Synthesizer",
    "Sampler",
    "Harpsichord",
    "Percussion",
    "Drum kit",
    "Drum machine",
    "Drum",
    "Snare drum",
    "Rimshot",
    "Drum roll",
    "Bass drum",
    "Timpani",
    "Tabla",
    "Cymbal",
    "Hi-hat",
    "Wood block",
    "Tambourine",
    "Rattle (instrument)",
    "Maraca",
    "Gong",
    "Tubular bells",
    "Mallet percussion",
    "Marimba, xylophone",
    "Glockenspiel",
    "Vibraphone",
    "Steelpan",
    "Orchestra",
    "Brass instrument",
    "French horn",
    "Trumpet",
    "Trombone",
    "Bowed string instrument",
    "String section",
    "Violin, fiddle",
    "Pizzicato",
    "Cello",
    "Double bass",
    "Wind instrument, woodwind instrument",
    "Flute",
    "Saxophone",
    "Clarinet",
    "Harp",
    "Bell",
    "Church bell",
    "Jingle bell",
    "Bicycle bell",
    "Tuning fork",
    "Chime",
    "Wind chime",
    "Change ringing (campanology)",
    "Harmonica",
    "Accordion",
    "Bagpipes",
    "Didgeridoo",
    "Shofar",
    "Theremin",
    "Singing bowl",
    "Scratching (performance technique)",
    "Pop music",
    "Hip hop music",
    "Beatboxing",
    "Rock music",
    "Heavy metal",
    "Punk rock",
    "Grunge",
    "Progressive rock",
    "Rock and roll",
    "Psychedelic rock",
    "Rhythm and blues",
    "Soul music",
    "Reggae",
    "Country",
    "Swing music",
    "Bluegrass",
    "Funk",
    "Folk music",
    "Middle Eastern music",
    "Jazz",
    "Disco",
    "Classical music",
    "Opera",
    "Electronic music",
    "House music",
    "Techno",
    "Dubstep",
    "Drum and bass",
    "Electronica",
    "Electronic dance music",
    "Ambient music",
    "Trance music",
    "Music of Latin America",
    "Salsa music",
    "Flamenco",
    "Blues",
    "Music for children",
    "New-age music",
    "Vocal music",
    "A capella",
    "Music of Africa",
    "Afrobeat",
    "Christian music",
    "Gospel music",
    "Music of Asia",
    "Carnatic music",
    "Music of Bollywood",
    "Ska",
    "Traditional music",
    "Independent music",
    "Song",
    "Background music",
    "Theme music",
    "Jingle (music)",
    "Soundtrack music",
    "Lullaby",
    "Video game music",
    "Christmas music",
    "Dance music",
    "Wedding music",
    "Happy music",
    "Sad music",
    "Tender music",
    "Exciting music",
    "Angry music",
    "Scary music",
    "Wind",
    "Rustling leaves",
    "Wind noise (microphone)",
    "Thunderstorm",
    "Thunder",
    "Water",
    "Rain",
    "Raindrop",
    "Rain on surface",
    "Stream",
    "Waterfall",
    "Ocean",
    "Waves, surf",
    "Steam",
    "Gurgling",
    "Fire",
    "Crackle",
    "Vehicle",
    "Boat, Water vehicle",
    "Sailboat, sailing ship",
    "Rowboat, canoe, kayak",
    "Motorboat, speedboat",
    "Ship",
    "Motor vehicle (road)",
    "Car",
    "Vehicle horn, car horn, honking",
    "Toot",
    "Car alarm",
    "Power windows, electric windows",
    "Skidding",
    "Tire squeal",
    "Car passing by",
    "Race car, auto racing",
    "Truck",
    "Air brake",
    "Air horn, truck horn",
    "Reversing beeps",
    "Ice cream truck, ice cream van",
    "Bus",
    "Emergency vehicle",
    "Police car (siren)",
    "Ambulance (siren)",
    "Fire engine, fire truck (siren)",
    "Motorcycle",
    "Traffic noise, roadway noise",
    "Rail transport",
    "Train",
    "Train whistle",
    "Train horn",
    "Railroad car, train wagon",
    "Train wheels squealing",
    "Subway, metro, underground",
    "Aircraft",
    "Aircraft engine",
    "Jet engine",
    "Propeller, airscrew",
    "Helicopter",
    "Fixed-wing aircraft, airplane",
    "Bicycle",
    "Skateboard",
    "Engine",
    "Light engine (high frequency)",
    "Dental drill, dentist's drill",
    "Lawn mower",
    "Chainsaw",
    "Medium engine (mid frequency)",
    "Heavy engine (low frequency)",
    "Engine knocking",
    "Engine starting",
    "Idling",
    "Accelerating, revving, vroom",
    "Door",
    "Doorbell",
    "Ding-dong",
    "Sliding door",
    "Slam",
    "Knock",
    "Tap",
    "Squeak",
    "Cupboard open or close",
    "Drawer open or close",
    "Dishes, pots, and pans",
    "Cutlery, silverware",
    "Chopping (food)",
    "Frying (food)",
    "Microwave oven",
    "Blender",
    "Water tap, faucet",
    "Sink (filling or washing)",
    "Bathtub (filling or washing)",
    "Hair dryer",
    "Toilet flush",
    "Toothbrush",
    "Electric toothbrush",
    "Vacuum cleaner",
    "Zipper (clothing)",
    "Keys jangling",
    "Coin (dropping)",
    "Scissors",
    "Electric shaver, electric razor",
    "Shuffling cards",
    "Typing",
    "Typewriter",
    "Computer keyboard",
    "Writing",
    "Alarm",
    "Telephone",
    "Telephone bell ringing",
    "Ringtone",
    "Telephone dialing, DTMF",
    "Dial tone",
    "Busy signal",
    "Alarm clock",
    "Siren",
    "Civil defense siren",
    "Buzzer",
    "Smoke detector, smoke alarm",
    "Fire alarm",
    "Foghorn",
    "Whistle",
    "Steam whistle",
    "Mechanisms",
    "Ratchet, pawl",
    "Clock",
    "Tick",
    "Tick-tock",
    "Gears",
    "Pulleys",
    "Sewing machine",
    "Mechanical fan",
    "Air conditioning",
    "Cash register",
    "Printer",
    "Camera",
    "Single-lens reflex camera",
    "Tools",
    "Hammer",
    "Jackhammer",
    "Sawing",
    "Filing (rasp)",
    "Sanding",
    "Power tool",
    "Drill",
    "Explosion",
    "Gunshot, gunfire",
    "Machine gun",
    "Fusillade",
    "Artillery fire",
    "Cap gun",
    "Fireworks",
    "Firecracker",
    "Burst, pop",
    "Eruption",
    "Boom",
    "Wood",
    "Chop",
    "Splinter",
    "Crack",
    "Glass",
    "Chink, clink",
    "Shatter",
    "Liquid",
    "Splash, splatter",
    "Slosh",
    "Squish",
    "Drip",
    "Pour",
    "Trickle, dribble",
    "Gush",
    "Fill (with liquid)",
    "Spray",
    "Pump (liquid)",
    "Stir",
    "Boiling",
    "Sonar",
    "Arrow",
    "Whoosh, swoosh, swish",
    "Thump, thud",
    "Thunk",
    "Electronic tuner",
    "Effects unit",
    "Chorus effect",
    "Basketball bounce",
    "Bang",
    "Slap, smack",
    "Whack, thwack",
    "Smash, crash",
    "Breaking",
    "Bouncing",
    "Whip",
    "Flap",
    "Scratch",
    "Scrape",
    "Rub",
    "Roll",
    "Crushing",
    "Crumpling, crinkling",
    "Tearing",
    "Beep, bleep",
    "Ping",
    "Ding",
    "Clang",
    "Squeal",
    "Creak",
    "Rustle",
    "Whir",
    "Clatter",
    "Sizzle",
    "Clicking",
    "Clickety-clack",
    "Rumble",
    "Plop",
    "Jingle, tinkle",
    "Hum",
    "Zing",
    "Boing",
    "Crunch",
    "Silence",
    "Sine wave",
    "Harmonic",
    "Chirp tone",
    "Sound effect",
    "Pulse",
    "Inside, small room",
    "Inside, large room or hall",
    "Inside, public space",
    "Outside, urban or manmade",
    "Outside, rural or natural",
    "Reverberation",
    "Echo",
    "Noise",
    "Environmental noise",
    "Static",
    "Mains hum",
    "Distortion",
    "Sidetone",
    "Cacophony",
    "White noise",
    "Pink noise",
    "Throbbing",
    "Vibration",
    "Television",
    "Radio",
    "Field recording",
  ]
  private let yamnetDebugTopK = 8
  private let yamnetConsensusWindowCount = 3
  private let yamnetConsensusMatchCount = 2
  private let yamnetHornDampingFactor: Float = 0.12
  private let yamnetWhistleConsensusThreshold: Float = 0.30
  private let yamnetScreamConsensusThreshold: Float = 0.18
  private let yamnetScreamAggregateThreshold: Float = 0.34
  private var yamnetRecentEvidence: [YamnetEvidence] = []

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [
      "zetic:download",
      "zetic:token",
      "zetic:complete",
      "zetic:error",
      "zetic:yamnet-download",
      "zetic:yamnet-inference",
      "zetic:yamnet-detection",
      "zetic:yamnet-state",
      "zetic:yamnet-error",
    ]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  private func send(_ name: String, _ body: Any) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  private func setCancelled(_ value: Bool) {
    stateLock.lock()
    cancelRequested = value
    stateLock.unlock()
  }

  private func isCancelled() -> Bool {
    stateLock.lock()
    let value = cancelRequested
    stateLock.unlock()
    return value
  }

  private func trapNSException(_ block: () throws -> Void) throws {
    var swiftError: Error?
    let nsError = ZeticLlmExceptionTrap.trap {
      do {
        try block()
      } catch {
        swiftError = error
      }
    }

    if let swiftError = swiftError {
      throw swiftError
    }

    if let nsError = nsError {
      throw nsError
    }
  }

  @objc(loadModel:resolver:rejecter:)
  func loadModel(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let personalKey = options["personalKey"] as? String ?? ""
    let name = options["name"] as? String ?? ""

    Task.detached { [weak self] in
      guard let self = self else { return }

      do {
        var built: ZeticMLangeLLMModel?
        try self.trapNSException {
          built = try ZeticMLangeLLMModel(
            personalKey: personalKey,
            name: name,
            version: 1,
            modelMode: LLMModelMode.RUN_AUTO
          ) { progress in
            self.send("zetic:download", ["progress": progress])
          }
        }

        guard let built else {
          reject("zetic_load_failed", "Model init returned nil", nil)
          return
        }

        self.model = built
        resolve(nil)
      } catch {
        NSLog("[ZeticLlm] load failed: \(error)")
        reject("zetic_load_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(generate:resolver:rejecter:)
  func generate(
    _ prompt: NSString,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let promptString = prompt as String
    setCancelled(false)

    guard let model else {
      reject("zetic_no_model", "Model is not loaded. Call loadModel first.", nil)
      return
    }

    generationTask = Task.detached { [weak self] in
      guard let self = self else { return }

      try? self.trapNSException {
        try model.cleanUp()
      }

      do {
        NSLog("[ZeticLlm] generate: calling model.run, promptLen=\(promptString.count)")
        try self.trapNSException {
          _ = try model.run(promptString)
        }
        NSLog("[ZeticLlm] generate: model.run returned, entering token loop")

        var buffer = ""
        var count = 0
        while !Task.isCancelled && !self.isCancelled() {
          var token = ""
          try self.trapNSException {
            token = model.waitForNextToken().token
          }
          if token.isEmpty { break }
          buffer.append(token)
          count += 1
          self.send("zetic:token", ["token": token, "count": count])
        }

        NSLog("[ZeticLlm] generate: complete, tokens=\(count)")
        try? self.trapNSException {
          try model.cleanUp()
        }
        self.send("zetic:complete", ["text": buffer, "count": count])
        resolve(buffer)
      } catch {
        NSLog("[ZeticLlm] generate failed: \(error)")
        try? self.trapNSException {
          try model.cleanUp()
        }
        self.send("zetic:error", ["message": error.localizedDescription])
        reject("zetic_generate_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(stop:rejecter:)
  func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    setCancelled(true)
    generationTask?.cancel()
    if let model {
      try? self.trapNSException {
        try model.cleanUp()
      }
    }
    resolve(nil)
  }

  @objc(startAcousticMonitoring:resolver:rejecter:)
  func startAcousticMonitoring(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let personalKey = options["personalKey"] as? String
    let name = options["name"] as? String
    let version = options["version"] as? Int
    let scoreThreshold = options["scoreThreshold"] as? NSNumber
    let amplitudeThreshold = options["amplitudeThreshold"] as? NSNumber

    if let scoreThreshold {
      yamnetScoreThreshold = scoreThreshold.floatValue
    }
    if let amplitudeThreshold {
      yamnetAmplitudeThreshold = amplitudeThreshold.floatValue
    }

    Task.detached { [weak self] in
      guard let self = self else { return }

      do {
        try await self.ensureRecordPermission()
        try self.configureAudioSession()
        try self.ensureYamnetLoaded(
          personalKey: personalKey ?? self.yamnetFallbackKey,
          name: name ?? self.yamnetFallbackName,
          version: version ?? self.yamnetFallbackVersion
        )
        try self.startAudioEngine()
        self.send("zetic:yamnet-state", ["state": "listening"])
        resolve(nil)
      } catch {
        NSLog("[ZeticLlm] yamnet start failed: \(error)")
        self.send("zetic:yamnet-error", ["message": error.localizedDescription])
        reject("zetic_yamnet_start_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(stopAcousticMonitoring:rejecter:)
  func stopAcousticMonitoring(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stopAudioEngine()
    send("zetic:yamnet-state", ["state": "stopped"])
    resolve(nil)
  }

  private func ensureRecordPermission() async throws {
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted:
      return
    case .denied:
      throw NSError(
        domain: "NorthstarYamnet",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Microphone permission is required for distress listening."]
      )
    case .undetermined:
      let granted = await withCheckedContinuation { continuation in
        session.requestRecordPermission { allowed in
          continuation.resume(returning: allowed)
        }
      }
      if !granted {
        throw NSError(
          domain: "NorthstarYamnet",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Microphone permission was not granted."]
        )
      }
    @unknown default:
      throw NSError(
        domain: "NorthstarYamnet",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Unknown microphone permission state."]
      )
    }
  }

  private func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
    try session.setPreferredSampleRate(16_000)
    try session.setPreferredIOBufferDuration(0.064)
    try session.setActive(true, options: [])
  }

  private func ensureYamnetLoaded(personalKey: String, name: String, version: Int) throws {
    if yamnetModel != nil {
      return
    }

    var built: ZeticMLangeModel?
    try trapNSException {
      built = try ZeticMLangeModel(
        personalKey: personalKey,
        name: name,
        version: version,
        modelMode: .RUN_AUTO
      ) { progress in
        self.send("zetic:yamnet-download", ["progress": progress])
      }
    }

    guard let built else {
      throw NSError(
        domain: "NorthstarYamnet",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "YAMNET model init returned nil."]
      )
    }

    yamnetModel = built
  }

  private func startAudioEngine() throws {
    if yamnetMonitoring {
      return
    }

    let engine = AVAudioEngine()
    let inputNode = engine.inputNode
    let inputFormat = inputNode.outputFormat(forBus: 0)

    audioConverter = AVAudioConverter(from: inputFormat, to: yamnetTargetFormat)
    yamnetSampleWindow.removeAll(keepingCapacity: true)
    yamnetInferenceInFlight = false
    yamnetLastInferenceAt = 0
    yamnetRecentEvidence.removeAll(keepingCapacity: false)
    inputNode.removeTap(onBus: 0)

    inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
      self?.handleIncomingAudioBuffer(buffer)
    }

    engine.prepare()
    try engine.start()

    audioEngine = engine
    yamnetMonitoring = true
    NSLog("[ZeticLlm][YAMNET] audio engine started sampleRate=\(inputFormat.sampleRate) channels=\(inputFormat.channelCount)")
  }

  private func stopAudioEngine() {
    yamnetQueue.sync {
      self.yamnetMonitoring = false
      self.yamnetInferenceInFlight = false
      self.yamnetSampleWindow.removeAll(keepingCapacity: false)
      self.yamnetRecentEvidence.removeAll(keepingCapacity: false)
    }

    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
    audioConverter = nil

    do {
      try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    } catch {
      NSLog("[ZeticLlm] yamnet stop session failed: \(error)")
    }
  }

  private func handleIncomingAudioBuffer(_ buffer: AVAudioPCMBuffer) {
    guard yamnetMonitoring else { return }
    guard let converted = convertToYamnetSamples(buffer) else { return }

    yamnetQueue.async { [weak self] in
      guard let self = self, self.yamnetMonitoring else { return }

      self.yamnetSampleWindow.append(contentsOf: converted)
      if self.yamnetSampleWindow.count > self.yamnetWindowSize * 2 {
        self.yamnetSampleWindow.removeFirst(self.yamnetSampleWindow.count - self.yamnetWindowSize * 2)
      }

      let now = CACurrentMediaTime()
      guard
        self.yamnetSampleWindow.count >= self.yamnetWindowSize,
        !self.yamnetInferenceInFlight,
        now - self.yamnetLastInferenceAt >= self.yamnetWindowStrideSeconds
      else {
        return
      }

      let window = Array(self.yamnetSampleWindow.suffix(self.yamnetWindowSize))
      self.yamnetInferenceInFlight = true
      self.yamnetLastInferenceAt = now
      NSLog(
        "[ZeticLlm][YAMNET] scheduling inference windowSamples=\(window.count) bufferedSamples=\(self.yamnetSampleWindow.count)"
      )
      self.runYamnet(on: window)
    }
  }

  private func convertToYamnetSamples(_ buffer: AVAudioPCMBuffer) -> [Float]? {
    guard let converter = audioConverter else { return nil }

    let ratio = yamnetTargetFormat.sampleRate / buffer.format.sampleRate
    let targetCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32

    guard let converted = AVAudioPCMBuffer(
      pcmFormat: yamnetTargetFormat,
      frameCapacity: targetCapacity
    ) else {
      return nil
    }

    var sourceConsumed = false
    var error: NSError?
    let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
      if sourceConsumed {
        outStatus.pointee = .noDataNow
        return nil
      }

      sourceConsumed = true
      outStatus.pointee = .haveData
      return buffer
    }

    converter.convert(to: converted, error: &error, withInputFrom: inputBlock)

    if let error {
      NSLog("[ZeticLlm] yamnet convert failed: \(error)")
      return nil
    }

    guard let channel = converted.floatChannelData?[0] else {
      return nil
    }

    let frameCount = Int(converted.frameLength)
    return Array(UnsafeBufferPointer(start: channel, count: frameCount))
  }

  private func runYamnet(on samples: [Float]) {
    defer {
      yamnetInferenceInFlight = false
    }

    guard let yamnetModel else { return }

    do {
      let inputTensor = Tensor(
        data: floatArrayToData(samples),
        dataType: BuiltinDataType.float32,
        shape: [1, yamnetWindowSize]
      )

      var outputs: [Tensor] = []
      try trapNSException {
        outputs = try yamnetModel.run(inputs: [inputTensor])
      }

      guard let scores = extractYamnetScores(from: outputs) else {
        let shapes = outputs.map(\.shape)
        NSLog("[ZeticLlm][YAMNET] could not locate 521-class output tensor shapes=\(shapes)")
        return
      }

      let rms = rootMeanSquare(samples)
      let topPredictions = topPredictions(from: scores, limit: yamnetDebugTopK)
      let detection = detectDistress(scores: scores, rms: rms)
      let screamHit = bestHit(in: screamIndices, scores: scores)
      let whistleScore = adjustedScore(at: whistleIndex, scores: scores)
      let topSummary = topPredictions
        .map { "\($0.label)=\(String(format: "%.3f", $0.score)) [\($0.index)]" }
        .joined(separator: ", ")

      NSLog(
        "[ZeticLlm][YAMNET] inference rms=\(String(format: "%.5f", rms)) threshold(score=\(String(format: "%.3f", yamnetScoreThreshold)), amp=\(String(format: "%.5f", yamnetAmplitudeThreshold))) top=\(topSummary)"
      )
      if let screamHit {
        NSLog(
          "[ZeticLlm][YAMNET] distress candidates scream=\(screamHit.label)=\(String(format: "%.3f", screamHit.score)) whistle=\(String(format: "%.3f", whistleScore))"
        )
      } else {
        NSLog(
          "[ZeticLlm][YAMNET] distress candidates scream=none whistle=\(String(format: "%.3f", whistleScore))"
        )
      }

      send(
        "zetic:yamnet-inference",
        [
          "rms": rms,
          "predictions": topPredictions.map { prediction in
            [
              "index": prediction.index,
              "label": prediction.label,
              "score": prediction.score,
            ]
          },
          "triggeredLabel": detection?.label as Any,
          "triggeredScore": detection?.score as Any,
          "topLabel": topPredictions.first?.label as Any,
          "topScore": topPredictions.first?.score as Any,
        ]
      )

      guard let detection else {
        NSLog("[ZeticLlm][YAMNET] no trigger")
        return
      }

      let now = CACurrentMediaTime()
      if now - yamnetLastTriggerAt < yamnetTriggerCooldownSeconds {
        NSLog(
          "[ZeticLlm][YAMNET] trigger suppressed by cooldown label=\(detection.label) score=\(String(format: "%.3f", detection.score))"
        )
        return
      }

      yamnetLastTriggerAt = now
      NSLog(
        "[ZeticLlm][YAMNET] TRIGGER label=\(detection.label) score=\(String(format: "%.3f", detection.score)) rms=\(String(format: "%.5f", rms)) topLabel=\(detection.topLabel) topScore=\(String(format: "%.3f", detection.topScore))"
      )
      send(
        "zetic:yamnet-detection",
        [
          "label": detection.label,
          "score": detection.score,
          "rms": rms,
          "topLabel": detection.topLabel,
          "topScore": detection.topScore,
        ]
      )
    } catch {
      NSLog("[ZeticLlm] yamnet inference failed: \(error)")
      send("zetic:yamnet-error", ["message": error.localizedDescription])
    }
  }

  private func detectDistress(scores: [Float], rms: Float) -> (label: String, score: Float, topLabel: String, topScore: Float)? {
    guard let top = scores.enumerated().max(by: { $0.element < $1.element }) else {
      return nil
    }

    let topLabel = label(for: top.offset)
    let topThree = topPredictions(from: scores, limit: 3)
    let screamHit = bestHit(in: screamIndices, scores: scores)
    let screamAggregateScore = aggregateScore(in: screamIndices, scores: scores)
    let screamTop3Hit = topThree.contains { screamIndices.contains($0.index) }
    let nextBestNonScreamScore = bestNonScreamScore(scores: scores)
    let whistleScore = adjustedScore(at: whistleIndex, scores: scores)
    let hornScore = max(
      adjustedScore(at: vehicleHornIndex, scores: scores),
      adjustedScore(at: airHornIndex, scores: scores)
    )

    if let screamHit {
      appendEvidence(
        YamnetEvidence(
          screamLabel: screamHit.label,
          screamScore: screamHit.score,
          screamAggregateScore: screamAggregateScore,
          screamTop3Hit: screamTop3Hit,
          whistleScore: whistleScore,
          hornScore: hornScore,
          rms: rms
        )
      )
    } else {
      appendEvidence(
        YamnetEvidence(
          screamLabel: label(for: screamIndices.first ?? 6),
          screamScore: 0,
          screamAggregateScore: screamAggregateScore,
          screamTop3Hit: screamTop3Hit,
          whistleScore: whistleScore,
          hornScore: hornScore,
          rms: rms
        )
      )
    }

    let recentEvidence = Array(yamnetRecentEvidence.suffix(yamnetConsensusWindowCount))
    let screamConsensusCount = consensusCount(
      in: recentEvidence,
      predicate: { evidence in
        (
          evidence.screamScore >= yamnetScreamConsensusThreshold ||
            evidence.screamTop3Hit ||
            evidence.screamAggregateScore >= yamnetScreamAggregateThreshold
        ) &&
          evidence.rms >= yamnetAmplitudeThreshold
      }
    )
    let whistleConsensusCount = consensusCount(
      in: recentEvidence,
      predicate: { evidence in
        evidence.whistleScore >= yamnetWhistleConsensusThreshold &&
          evidence.rms >= yamnetAmplitudeThreshold * 1.5
      }
    )

    if
      let dominantScream = dominantScreamHit(in: recentEvidence),
      screamConsensusCount >= yamnetConsensusMatchCount,
      (
        average(in: recentEvidence.map(\.screamScore)) >= yamnetScoreThreshold ||
          average(in: recentEvidence.map(\.screamAggregateScore)) >= yamnetScreamAggregateThreshold ||
          recentEvidence.contains(where: \.screamTop3Hit)
      ),
      average(in: recentEvidence.map(\.rms)) >= yamnetAmplitudeThreshold,
      average(in: recentEvidence.map(\.hornScore)) < max(dominantScream.score, 0.1) * 0.6,
      screamAggregateScore >= nextBestNonScreamScore || screamTop3Hit
    {
      return (
        label: dominantScream.label,
        score: max(dominantScream.score, screamAggregateScore),
        topLabel: topLabel,
        topScore: top.element
      )
    }

    if
      whistleConsensusCount >= yamnetConsensusMatchCount,
      average(in: recentEvidence.map(\.whistleScore)) >= max(yamnetScoreThreshold + 0.1, 0.32),
      average(in: recentEvidence.map(\.hornScore)) < average(in: recentEvidence.map(\.whistleScore)) * 0.45
    {
      return (
        label: label(for: whistleIndex),
        score: average(in: recentEvidence.map(\.whistleScore)),
        topLabel: topLabel,
        topScore: top.element
      )
    }

    return nil
  }

  private func bestHit(in indices: [Int], scores: [Float]) -> (label: String, score: Float)? {
    var best: (label: String, score: Float)?

    for index in indices {
      let value = adjustedScore(at: index, scores: scores)
      if best == nil || value > best!.score {
        best = (label: label(for: index), score: value)
      }
    }

    return best
  }

  private func aggregateScore(in indices: [Int], scores: [Float]) -> Float {
    indices.reduce(into: Float.zero) { total, index in
      total += adjustedScore(at: index, scores: scores)
    }
  }

  private func bestNonScreamScore(scores: [Float]) -> Float {
    scores.enumerated().reduce(into: Float.zero) { best, entry in
      guard !screamIndices.contains(entry.offset) else { return }
      let candidate = adjustedScore(at: entry.offset, scores: scores)
      if candidate > best {
        best = candidate
      }
    }
  }

  private func topPredictions(from scores: [Float], limit: Int) -> [(index: Int, label: String, score: Float)] {
    scores
      .enumerated()
      .sorted(by: { $0.element > $1.element })
      .prefix(limit)
      .map { entry in
        (
          index: entry.offset,
          label: label(for: entry.offset),
          score: entry.element
        )
      }
  }

  private func extractYamnetScores(from outputs: [Tensor]) -> [Float]? {
    let describedShapes = outputs.map(\.shape)
    NSLog("[ZeticLlm][YAMNET] output shapes=\(describedShapes)")

    for tensor in outputs {
      if let scores = extractScores(from: tensor) {
        return scores
      }
    }

    return nil
  }

  private func extractScores(from tensor: Tensor) -> [Float]? {
    let values = sanitizeScores(DataUtils.dataToFloatArray(tensor.data))
    guard !values.isEmpty else { return nil }

    if tensor.shape.last == yamnetClassCount {
      let frameCount = max(1, values.count / yamnetClassCount)
      guard frameCount * yamnetClassCount == values.count else { return nil }
      if frameCount == 1 {
        return values
      }
      return averageFrames(values, frameCount: frameCount, classesPerFrame: yamnetClassCount)
    }

    if values.count == yamnetClassCount {
      return values
    }

    return nil
  }

  private func averageFrames(_ values: [Float], frameCount: Int, classesPerFrame: Int) -> [Float] {
    var averaged = Array(repeating: Float.zero, count: classesPerFrame)

    for frameIndex in 0..<frameCount {
      let start = frameIndex * classesPerFrame
      for classIndex in 0..<classesPerFrame {
        averaged[classIndex] += values[start + classIndex]
      }
    }

    let divisor = Float(frameCount)
    for classIndex in 0..<classesPerFrame {
      averaged[classIndex] /= divisor
    }

    return sanitizeScores(averaged)
  }

  private func sanitizeScores(_ values: [Float]) -> [Float] {
    let invalidCount = values.reduce(into: 0) { count, value in
      if !value.isFinite || value.isNaN {
        count += 1
      }
    }

    if invalidCount > 0 {
      NSLog("[ZeticLlm][YAMNET] sanitized non-finite scores count=\(invalidCount)")
    }

    return values.enumerated().map { index, value in
      if suppressedYamnetIndices.contains(index) {
        return 0
      }
      if value.isFinite && !value.isNaN {
        return value
      }
      return 0
    }
  }

  private func label(for index: Int) -> String {
    guard index >= 0, index < yamnetLabels.count else {
      return "Class \(index)"
    }
    return yamnetLabels[index]
  }

  private func score(at index: Int, scores: [Float]) -> Float {
    guard index >= 0, index < scores.count else {
      return 0
    }
    return scores[index]
  }

  private func adjustedScore(at index: Int, scores: [Float]) -> Float {
    let base = score(at: index, scores: scores)
    if index == vehicleHornIndex || index == airHornIndex {
      return base * yamnetHornDampingFactor
    }
    return base
  }

  private func appendEvidence(_ evidence: YamnetEvidence) {
    yamnetRecentEvidence.append(evidence)
    if yamnetRecentEvidence.count > yamnetConsensusWindowCount {
      yamnetRecentEvidence.removeFirst(yamnetRecentEvidence.count - yamnetConsensusWindowCount)
    }
  }

  private func consensusCount(
    in evidence: [YamnetEvidence],
    predicate: (YamnetEvidence) -> Bool
  ) -> Int {
    evidence.reduce(into: 0) { count, item in
      if predicate(item) {
        count += 1
      }
    }
  }

  private func average(in values: [Float]) -> Float {
    guard !values.isEmpty else { return 0 }
    return values.reduce(0, +) / Float(values.count)
  }

  private func dominantScreamHit(in evidence: [YamnetEvidence]) -> (label: String, score: Float)? {
    guard let best = evidence.max(by: { $0.screamScore < $1.screamScore }) else {
      return nil
    }
    return (label: best.screamLabel, score: best.screamScore)
  }

  private func rootMeanSquare(_ samples: [Float]) -> Float {
    guard !samples.isEmpty else { return 0 }
    let sumSquares = samples.reduce(Float.zero) { partial, sample in
      partial + (sample * sample)
    }
    return sqrt(sumSquares / Float(samples.count))
  }

  private func floatArrayToData(_ values: [Float]) -> Data {
    values.withUnsafeBufferPointer { buffer in
      Data(buffer: buffer)
    }
  }
}
