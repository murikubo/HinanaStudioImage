import SwiftUI
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }

    window = UIWindow(windowScene: windowScene)
    window?.overrideUserInterfaceStyle = .dark
    window?.rootViewController = NativeUpgradeController()
    window?.makeKeyAndVisible()
    if let url = connectionOptions.urlContexts.first?.url { openProject(url) }
    #if DEBUG
      NativeDiagnostics.run()
    #endif

  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    if let url = URLContexts.first?.url { openProject(url) }
  }

  private func openProject(_ url: URL) {
    guard let root = window?.rootViewController as? NativeUpgradeController else { return }
    if root.ready {
      NativeLibrary.shared.importProject(url)
    } else {
      root.onReady = { NativeLibrary.shared.importProject(url) }
    }
  }
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {

  }
}
