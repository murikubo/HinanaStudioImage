import Capacitor

class HinanaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HinanaImagesPlugin())
    }
}
