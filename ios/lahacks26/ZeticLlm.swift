import Foundation
import React
import ZeticMLange

@objc(ZeticLlm)
class ZeticLlm: RCTEventEmitter {
  private let stateLock = NSLock()
  private var model: ZeticMLangeLLMModel?
  private var generationTask: Task<Void, Never>?
  private var cancelRequested = false
  private var hasListeners = false

  override init() {
    super.init()
  }

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["zetic:download", "zetic:token", "zetic:complete", "zetic:error"]
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
    let v = cancelRequested
    stateLock.unlock()
    return v
  }

  private func trapNSException(_ block: () throws -> Void) throws {
    var swiftError: Error?
    let nsError = ZeticLlmExceptionTrap.trap {
      do { try block() } catch { swiftError = error }
    }
    if let swiftError = swiftError { throw swiftError }
    if let nsError = nsError { throw nsError }
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
            modelMode: LLMModelMode.RUN_AUTO,
          ) { progress in
            self.send("zetic:download", ["progress": progress])
          }
        }
        guard let m = built else {
          reject("zetic_load_failed", "Model init returned nil", nil)
          return
        }
        self.model = m
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

    guard let model = self.model else {
      reject("zetic_no_model", "Model is not loaded. Call loadModel first.", nil)
      return
    }

    generationTask = Task.detached { [weak self] in
      guard let self = self else { return }

      try? self.trapNSException { try model.cleanUp() }

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
        try? self.trapNSException { try model.cleanUp() }
        self.send("zetic:complete", ["text": buffer, "count": count])
        resolve(buffer)
      } catch {
        NSLog("[ZeticLlm] generate failed: \(error)")
        try? self.trapNSException { try model.cleanUp() }
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
    if let model = self.model {
      try? self.trapNSException { try model.cleanUp() }
    }
    resolve(nil)
  }
}
